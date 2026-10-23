import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { render } from '../../../common/template/template.engine';
import { findCatalogEntry } from './catalog.index';
import { PATTERNS, type CatalogEntry, type CatalogOperation } from './catalog.types';

const MICROSOFT_IDS = ['microsoft-calendar', 'microsoft-todo', 'microsoft-planner', 'microsoft-teams'];

const entry = (id: string): CatalogEntry => findCatalogEntry(id)!;
const op = (id: string, key: string): CatalogOperation => entry(id).operations.find((o) => o.key === key)!;

/** Entradas referenciadas (`input.x`) dentro de una plantilla. */
const inputRefs = (template: unknown): string[] =>
  JSON.stringify(template ?? '')
    .match(/\{\{\s*input\.([A-Za-z0-9_]+)/g)
    ?.map((m) => m.replace(/\{\{\s*input\./, '')) ?? [];

type Def = { path: string; query?: Record<string, unknown>; headers?: Record<string, unknown>; body?: unknown };

describe('catálogo: Microsoft 365 (Microsoft Graph)', () => {
  const ajv = addFormats(new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true }));

  it('registra las cuatro integraciones con OAuth de Microsoft, User.Read y offline_access', () => {
    for (const id of MICROSOFT_IDS) {
      const auth = entry(id).auth.oauth2_code;
      expect(auth?.type).toBe('oauth2_code');
      if (auth?.type !== 'oauth2_code') continue;
      expect(auth.provider).toBe('microsoft');
      expect(auth.scopes).toEqual(expect.arrayContaining(['offline_access', 'User.Read']));
      expect(auth.accountLabel).toEqual({ url: 'https://graph.microsoft.com/v1.0/me', path: 'userPrincipalName' });
      expect(entry(id).config).toEqual({ baseUrl: 'https://graph.microsoft.com/v1.0' });
    }
    const scopes = (id: string) => {
      const auth = entry(id).auth.oauth2_code;
      return auth?.type === 'oauth2_code' ? auth.scopes : [];
    };
    expect(scopes('microsoft-calendar')).toEqual(
      expect.arrayContaining(['Calendars.ReadWrite', 'Calendars.Read.Shared']),
    );
    expect(scopes('microsoft-todo')).toContain('Tasks.ReadWrite');
    expect(scopes('microsoft-planner')).toContain('Tasks.ReadWrite');
    expect(scopes('microsoft-teams')).toEqual(
      expect.arrayContaining([
        'Team.ReadBasic.All',
        'ChannelMessage.Send',
        'ChatMessage.Send',
        'OnlineMeetings.ReadWrite',
      ]),
    );
  });

  describe.each(MICROSOFT_IDS)('%s', (id) => {
    it.each(entry(id).operations.map((o) => [o.key, o] as const))(
      '%s: toda entrada en ruta o cabecera tiene un patrón seguro',
      (_key, operation) => {
        const def = operation.definition as unknown as Def;
        const properties = (operation.inputSchema.properties ?? {}) as Record<string, { pattern?: string }>;
        for (const name of inputRefs(def.path)) {
          expect([PATTERNS.graphId, PATTERNS.pathId]).toContain(properties[name].pattern);
        }
        for (const name of inputRefs(def.headers)) {
          expect([PATTERNS.graphEtag, PATTERNS.timeZone, PATTERNS.singleLine]).toContain(properties[name].pattern);
        }
      },
    );
  });

  it('PATTERNS.graphId admite ids reales de Graph y rechaza inyección de rutas', () => {
    const re = new RegExp(PATTERNS.graphId, 'u');
    for (const ok of [
      'AAMkAGI2TG93AAA=',
      'AAMkADY5MjE2ZjEzLWQxMWEtNGZkYi04ZmUzLTAwZDM4MGE5ZDU2MwBGAAAAAAAqeMbgdAc8RKYiYVNI_x5bBwA-l7n0AAA=',
      '19:4a95f7d8db4c4e7fae857bcebe0623e6@thread.tacv2',
      '19:2da4c29f6d7041eca70b638b43d45437@thread.v2',
      'xqQg5FS2LkCp935s-FIFm2QAFkHM',
      'fbe2bf47-16c8-47cf-b4a5-4b9b187c508b',
    ]) {
      expect(re.test(ok)).toBe(true);
    }
    for (const bad of [
      '',
      '.',
      '..',
      '...',
      'a/../b',
      'a..b',
      'a/b',
      'a?x=1',
      'a#b',
      'a%2Fb',
      'a b',
      'a\nb',
      'x'.repeat(513),
    ]) {
      expect(re.test(bad)).toBe(false);
    }
  });

  it('PATTERNS.graphEtag y PATTERNS.timeZone no admiten saltos de línea ni comillas sueltas', () => {
    const etag = new RegExp(PATTERNS.graphEtag, 'u');
    expect(etag.test('W/"JzEtVGFzayAgQEBAQEBAQEBAQEBAQEBAWCc="')).toBe(true);
    expect(etag.test('"JzEtQnVja2V0QEBAQEBAQEBAQEBAQEBARCc="')).toBe(true);
    expect(etag.test('W/"abc"\r\nX-Evil: 1')).toBe(false);
    expect(etag.test('W/"a"b"')).toBe(false);
    expect(etag.test('abc')).toBe(false);

    const tz = new RegExp(PATTERNS.timeZone, 'u');
    for (const ok of [
      'UTC',
      'America/Bogota',
      'America/Argentina/Buenos_Aires',
      'Etc/GMT+5',
      'SA Pacific Standard Time',
    ]) {
      expect(tz.test(ok)).toBe(true);
    }
    expect(tz.test('UTC"\r\nX-Evil: 1')).toBe(false);
    expect(tz.test('UTC", odata.maxpagesize=1')).toBe(false);
  });

  it('listar eventos envía el rango, $select/$orderby/$top y la zona en Prefer (UTC por defecto)', () => {
    const operation = op('microsoft-calendar', 'list_events');
    const input = { startDateTime: '2026-11-05T00:00:00-05:00', endDateTime: '2026-11-06T00:00:00-05:00' };
    const def = render<Def>(operation.definition, { input });
    expect(def.path).toBe('/me/calendarView');
    expect(def.query).toMatchObject({ ...input, $orderby: 'start/dateTime', $top: '50' });
    expect(String(def.query?.$select)).toContain('start,end');
    expect(def.headers).toEqual({ Prefer: 'outlook.timezone="UTC"' });

    const withTz = render<Def>(operation.definition, { input: { ...input, timeZone: 'America/Bogota', top: 10 } });
    expect(withTz.headers).toEqual({ Prefer: 'outlook.timezone="America/Bogota"' });
    expect(withTz.query?.$top).toBe(10);
  });

  it('crear evento con Teams envía isOnlineMeeting y onlineMeetingProvider', () => {
    const def = render<Def>(op('microsoft-calendar', 'create_event').definition, {
      input: {
        subject: 'Demo',
        start: '2026-11-05T15:00:00',
        end: '2026-11-05T15:30:00',
        timeZone: 'America/Bogota',
        isOnlineMeeting: true,
        onlineMeetingProvider: 'teamsForBusiness',
      },
    });
    expect(JSON.parse(JSON.stringify(def.body))).toMatchObject({
      start: { dateTime: '2026-11-05T15:00:00', timeZone: 'America/Bogota' },
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    });
  });

  it('actualizar evento solo envía los campos indicados', () => {
    const def = render<Def>(op('microsoft-calendar', 'update_event').definition, {
      input: { eventId: 'AAMkAGI2TG93AAA=', start: { dateTime: '2026-11-05T16:00:00', timeZone: 'UTC' } },
    });
    expect(def.path).toBe('/me/events/AAMkAGI2TG93AAA=');
    expect(JSON.parse(JSON.stringify(def.body))).toEqual({
      start: { dateTime: '2026-11-05T16:00:00', timeZone: 'UTC' },
    });
  });

  it('el id del evento con ".." o "/" no pasa la validación (sin traversal en /cancel)', () => {
    const validate = ajv.compile(op('microsoft-calendar', 'cancel_event').inputSchema);
    expect(validate({ eventId: 'AAMkAGI2TG93AAA=' })).toBe(true);
    expect(validate({ eventId: '..' })).toBe(false);
    expect(validate({ eventId: 'x/../../users/otro' })).toBe(false);
  });

  it('To Do: el filtro por estado es un enum cerrado y se omite si no se envía', () => {
    const operation = op('microsoft-todo', 'list_tasks');
    const validate = ajv.compile(operation.inputSchema);
    expect(validate({ listId: 'AAMkAGI2TG93AAA=', statusFilter: "status ne 'completed'" })).toBe(true);
    expect(validate({ listId: 'AAMkAGI2TG93AAA=', statusFilter: "status eq 'x' or 1 eq 1" })).toBe(false);
    const def = render<Def>(operation.definition, { input: { listId: 'AAMkAGI2TG93AAA=' } });
    expect(def.query?.$filter).toBeUndefined();
  });

  it('Planner: actualizar y completar exigen el etag y lo envían en If-Match', () => {
    for (const key of ['update_task', 'complete_task']) {
      const operation = op('microsoft-planner', key);
      expect(operation.inputSchema.required).toEqual(expect.arrayContaining(['taskId', 'etag']));
      expect(operation.description).toContain('Obtener tarea');
      const validate = ajv.compile(operation.inputSchema);
      expect(validate({ taskId: '01gzSlKkIUSUl6DF_EilrmQAKDhh' })).toBe(false);
      expect(validate({ taskId: '01gzSlKkIUSUl6DF_EilrmQAKDhh', etag: 'W/"x"\r\nHost: evil' })).toBe(false);
    }
    const etag = 'W/"JzEtVGFzayAgQEBAQEBAQEBAQEBAQEBAWCc="';
    const def = render<Def>(op('microsoft-planner', 'complete_task').definition, {
      input: { taskId: '01gzSlKkIUSUl6DF_EilrmQAKDhh', etag },
    });
    expect(def.path).toBe('/planner/tasks/01gzSlKkIUSUl6DF_EilrmQAKDhh');
    expect(def.headers).toEqual({ 'If-Match': etag, Prefer: 'return=representation' });
    expect(def.body).toEqual({ percentComplete: 100 });
  });

  it('Planner: las asignaciones se reciben como objeto con claves GUID y conservan su forma', () => {
    const operation = op('microsoft-planner', 'create_task');
    const validate = ajv.compile(operation.inputSchema);
    const assignments = {
      'fbab97d0-4932-4511-b675-204639209557': { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' },
    };
    expect(validate({ planId: 'xqQg5FS2LkCp935s-FIFm2QAFkHM', title: 'Llamar', assignments })).toBe(true);
    expect(
      validate({
        planId: 'xqQg5FS2LkCp935s-FIFm2QAFkHM',
        title: 'x',
        assignments: { 'ana@acme.com': assignments['fbab97d0-4932-4511-b675-204639209557'] },
      }),
    ).toBe(false);
    const def = render<Def>(operation.definition, {
      input: { planId: 'xqQg5FS2LkCp935s-FIFm2QAFkHM', title: 'Llamar', assignments },
    });
    expect(JSON.parse(JSON.stringify(def.body))).toEqual({
      planId: 'xqQg5FS2LkCp935s-FIFm2QAFkHM',
      title: 'Llamar',
      assignments,
    });
  });

  it('Teams: publica en canal con ids de Teams en la ruta y texto plano por defecto', () => {
    const def = render<Def>(op('microsoft-teams', 'post_channel_message').definition, {
      input: {
        teamId: 'fbe2bf47-16c8-47cf-b4a5-4b9b187c508b',
        channelId: '19:4a95f7d8db4c4e7fae857bcebe0623e6@thread.tacv2',
        content: 'Hola equipo',
      },
    });
    expect(def.path).toBe(
      '/teams/fbe2bf47-16c8-47cf-b4a5-4b9b187c508b/channels/19:4a95f7d8db4c4e7fae857bcebe0623e6@thread.tacv2/messages',
    );
    expect(JSON.parse(JSON.stringify(def.body))).toEqual({ body: { contentType: 'text', content: 'Hola equipo' } });
  });
});
