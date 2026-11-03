import type { INestApplication } from '@nestjs/common';
import { ConversationRetentionService } from '../src/modules/data-protection/conversation-retention.service';
import { PrivacySettingsService } from '../src/modules/data-protection/privacy-settings.service';
import { GrabacionConfigService } from '../src/modules/channels/voice/grabacion/grabacion-config.service';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, chat, createAgent, registerOwner, type Session } from './utils/fixtures';

const DAY = 24 * 3600 * 1000;

/**
 * P0.2 (Jurídica): retención preliminar 180 d, políticas de retención DIFERENCIADAS por org/canal/tipo, grabación real
 * OFF hasta validación jurídica y export con garantías (sin presumir valor probatorio). Multi-tenant, roles y auditoría.
 */
describe('Jurídica · retención/políticas/grabación P0.2 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let admin: Session;
  let editor: Session;
  let otro: Session;

  const policies = (s: Session) => s.api.get('/admin/data-protection/retention-policies');
  const upsertPolicy = (s: Session, body: Record<string, unknown>) =>
    s.api.put('/admin/data-protection/retention-policies', body);
  const resolve = (s: Session, qs: string) => s.api.get(`/admin/data-protection/retention-policies/resolve${qs}`);

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'jur-owner');
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'jur-admin' });
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'jur-editor' });
    otro = await registerOwner(app, 'jur-otro');
  });

  afterAll(async () => {
    const settings = app?.get(PrivacySettingsService);
    for (const s of [owner, otro]) if (s) await settings?.reset(s.workspaceId);
    await app?.close();
  });

  describe('Retención 180 d + políticas diferenciadas', () => {
    it('sin política: la resolución cae a la retención del workspace (180 d por defecto)', async () => {
      const r = (await resolve(owner, '?tipoInformacion=ORDINARIA').expect(200)).body as {
        retencionDias: number;
        origen: string;
        politicaAplicada: unknown;
      };
      expect(r).toMatchObject({ retencionDias: 180, origen: 'WORKSPACE', politicaAplicada: null });
    });

    it('la política más específica (canal + tipo) gana sobre las generales', async () => {
      await upsertPolicy(owner, { tipoInformacion: 'EVIDENCIA', retencionDias: 730 }).expect(200);
      await upsertPolicy(owner, { canal: 'VOZ', tipoInformacion: 'EVIDENCIA', retencionDias: 1095 }).expect(200);

      // VOZ/EVIDENCIA: gana la específica (1095).
      expect((await resolve(owner, '?canal=VOZ&tipoInformacion=EVIDENCIA').expect(200)).body).toMatchObject({
        retencionDias: 1095,
        origen: 'POLITICA',
        politicaAplicada: { canal: 'VOZ', tipoInformacion: 'EVIDENCIA' },
      });
      // CORREO/EVIDENCIA: no hay específica de ese canal ⇒ gana la de tipo (730).
      expect((await resolve(owner, '?canal=CORREO&tipoInformacion=EVIDENCIA').expect(200)).body).toMatchObject({
        retencionDias: 730,
        politicaAplicada: { canal: null, tipoInformacion: 'EVIDENCIA' },
      });
      // ORDINARIA sin política ⇒ 180 del workspace.
      expect((await resolve(owner, '?tipoInformacion=ORDINARIA').expect(200)).body).toMatchObject({
        retencionDias: 180,
        origen: 'WORKSPACE',
      });
    });

    it('upsert por alcance es idempotente (no duplica) y queda auditado', async () => {
      await upsertPolicy(owner, { canal: 'VOZ', tipoInformacion: 'EVIDENCIA', retencionDias: 900 }).expect(200);
      const lista = (await policies(owner).expect(200)).body as {
        canal: string | null;
        tipoInformacion: string | null;
      }[];
      const voz = lista.filter((p) => p.canal === 'VOZ' && p.tipoInformacion === 'EVIDENCIA');
      expect(voz).toHaveLength(1); // se actualizó, no se duplicó

      const audit = (
        await owner.api
          .get('/auditoria?action=POLITICA_RETENCION_MODIFICADA&targetType=PoliticaRetencion&take=50')
          .expect(200)
      ).body as { items: { metadata: { alcance: { canal: string | null } } }[] };
      expect(audit.items.length).toBeGreaterThanOrEqual(2);
    });

    it('solo ADMIN/OWNER: EDITOR recibe 403 al listar o modificar políticas', async () => {
      await policies(editor).expect(403);
      await upsertPolicy(editor, { retencionDias: 10 }).expect(403);
    });

    it('aislamiento multi-tenant: otro workspace no ve las políticas ajenas', async () => {
      expect((await policies(otro).expect(200)).body).toEqual([]);
      expect((await resolve(otro, '?canal=VOZ&tipoInformacion=EVIDENCIA').expect(200)).body).toMatchObject({
        retencionDias: 180,
        origen: 'WORKSPACE',
      });
    });

    it('valida alcance y plazo (class-validator)', async () => {
      await upsertPolicy(owner, { canal: 'TELEPATIA' }).expect(400);
      await upsertPolicy(owner, { tipoInformacion: 'OTRO' }).expect(400);
      await upsertPolicy(owner, { retencionDias: 0 }).expect(400);
      await upsertPolicy(owner, { retencionDias: 4000 }).expect(400);
    });
  });

  describe('La purga respeta la política resuelta', () => {
    it('conversación de 100 d: sobrevive con 180 por defecto; se purga al fijar una política CHAT/ORDINARIA de 90 d', async () => {
      const prisma = prismaOf(app);
      const purgador = app.get(ConversationRetentionService);
      const agent = (await createAgent(owner, { name: 'Jur Retención' })).id;
      const conv = await chat(owner, agent, 'conversación de prueba');
      const vieja = new Date(Date.now() - 100 * DAY);
      await prisma.$executeRaw`UPDATE "Conversation" SET "updatedAt" = ${vieja} WHERE id = ${conv.conversationId}`;

      // Con 180 d de plataforma, una conversación de 100 d sigue vigente.
      await purgador.purge(new Date(), owner.workspaceId);
      expect(await prisma.conversation.findUnique({ where: { id: conv.conversationId } })).not.toBeNull();

      // Política diferenciada CHAT/ORDINARIA a 90 d ⇒ ahora sí se purga.
      await upsertPolicy(owner, { canal: 'CHAT', tipoInformacion: 'ORDINARIA', retencionDias: 90 }).expect(200);
      const res = await purgador.purge(new Date(), owner.workspaceId);
      expect(res.conversations).toBeGreaterThanOrEqual(1);
      expect(await prisma.conversation.findUnique({ where: { id: conv.conversationId } })).toBeNull();
    });
  });

  describe('Grabación real OFF hasta validación jurídica (gate)', () => {
    const EMPRESA = 'empresa-jur-grab';
    const cfgUrl = `/grabacion-config/${EMPRESA}`;

    it('por defecto el gate jurídico está en false', async () => {
      const cfg = (await owner.api.get(`/grabacion-config?empresaId=${EMPRESA}`).expect(200)).body as {
        grabacionAutorizadaJuridicamente: boolean;
      };
      expect(cfg.grabacionAutorizadaJuridicamente).toBe(false);
    });

    it('con la bandera de audio en ON pero el gate en false, NO se puede grabar', async () => {
      await editor.api.put(cfgUrl, { grabarAudio: true }).expect(403); // solo ADMIN+
      await admin.api.put(cfgUrl, { grabarAudio: true, guardarTranscripcion: true }).expect(200);

      const grab = app.get(GrabacionConfigService);
      expect(await grab.puedeGrabar(owner.workspaceId, EMPRESA)).toBe(false);
      expect(await grab.puedeGuardarTranscripcion(owner.workspaceId, EMPRESA)).toBe(false);
      const ev = await grab.evaluarRetencionEmpresa(owner.workspaceId, EMPRESA, 'AUDIO');
      expect(ev.estado).toBe('BLOQUEADO_JURIDICA');
    });

    it('solo un ADMIN puede activar el gate; entonces se habilita la grabación y queda auditado', async () => {
      await editor.api.put(cfgUrl, { grabacionAutorizadaJuridicamente: true }).expect(403);
      const guardada = (await admin.api.put(cfgUrl, { grabacionAutorizadaJuridicamente: true }).expect(200)).body as {
        grabacionAutorizadaJuridicamente: boolean;
      };
      expect(guardada.grabacionAutorizadaJuridicamente).toBe(true);

      const grab = app.get(GrabacionConfigService);
      expect(await grab.puedeGrabar(owner.workspaceId, EMPRESA)).toBe(true);

      // El cambio del gate quedó auditado con las banderas anterior/nuevo (E13).
      const audit = (
        await owner.api
          .get('/auditoria?action=GRABACION_CONFIG_MODIFICADA&targetType=GrabacionConfig&take=50')
          .expect(200)
      ).body as { items: { metadata: { empresaId: string; nuevo: { grabacionAutorizadaJuridicamente: boolean } } }[] };
      const deEmpresa = audit.items.filter((e) => e.metadata?.empresaId === EMPRESA);
      expect(deEmpresa.some((e) => e.metadata.nuevo.grabacionAutorizadaJuridicamente === true)).toBe(true);
    });
  });
});
