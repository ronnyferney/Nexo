import type { PermisoPendiente } from '../../core/crews.models';
import {
  crewActions,
  resumirPermisosPendientes,
  totalesPermisosPendientes,
  type CrewRole,
} from './crews.logic';

const ADMIN: CrewRole = { isAdmin: true, canEdit: true };
const EDITOR: CrewRole = { isAdmin: false, canEdit: true };
const VIEWER: CrewRole = { isAdmin: false, canEdit: false };

describe('crewActions', () => {
  it('ADMIN sobre BORRADOR con miembros: versionar, publicar y retirar; nunca instanciar', () => {
    expect(crewActions('BORRADOR', ADMIN, true)).toEqual({
      addVersion: true,
      publish: true,
      retire: true,
      instantiate: false,
    });
  });

  it('publicar exige al menos un miembro', () => {
    expect(crewActions('BORRADOR', ADMIN, false).publish).toBeFalse();
  });

  it('una PUBLICADA no se vuelve a publicar, pero se instancia y se retira', () => {
    const a = crewActions('PUBLICADA', ADMIN, true);
    expect(a.publish).toBeFalse();
    expect(a.retire).toBeTrue();
    expect(a.addVersion).toBeTrue();
    expect(a.instantiate).toBeTrue();
  });

  it('una RETIRADA no admite versionar, publicar ni retirar de nuevo, ni instanciar', () => {
    expect(crewActions('RETIRADA', ADMIN, true)).toEqual({
      addVersion: false,
      publish: false,
      retire: false,
      instantiate: false,
    });
  });

  it('EDITOR solo instancia una PUBLICADA; no gobierna la plantilla', () => {
    expect(crewActions('PUBLICADA', EDITOR, true)).toEqual({
      addVersion: false,
      publish: false,
      retire: false,
      instantiate: true,
    });
    expect(crewActions('BORRADOR', EDITOR, true).instantiate).toBeFalse();
  });

  it('VIEWER no ve ninguna acción', () => {
    expect(crewActions('PUBLICADA', VIEWER, true)).toEqual({
      addVersion: false,
      publish: false,
      retire: false,
      instantiate: false,
    });
  });
});

describe('permisos pendientes', () => {
  const permisos: PermisoPendiente[] = [
    {
      agentId: 'a1',
      rol: 'Analista',
      cargoId: 'c1',
      skills: ['s1', 's2'],
      conectoresSugeridos: [{ ref: 'crm/leads' }],
      politicaSugerida: { maxGasto: 10 },
    },
    {
      agentId: 'a2',
      rol: 'Revisor',
      cargoId: null,
      skills: [],
      conectoresSugeridos: [],
      politicaSugerida: {},
    },
  ];

  it('resume cada permiso a recuentos legibles', () => {
    expect(resumirPermisosPendientes(permisos)).toEqual([
      { agentId: 'a1', rol: 'Analista', cargoId: 'c1', skillsCount: 2, conectoresCount: 1, tienePolitica: true },
      { agentId: 'a2', rol: 'Revisor', cargoId: null, skillsCount: 0, conectoresCount: 0, tienePolitica: false },
    ]);
  });

  it('tolera valores no-arreglo o ausentes sin romper', () => {
    const raros = [
      { agentId: 'x', rol: 'R', cargoId: null, skills: undefined, conectoresSugeridos: null, politicaSugerida: null },
    ] as unknown as PermisoPendiente[];
    expect(resumirPermisosPendientes(raros)[0]).toEqual({
      agentId: 'x',
      rol: 'R',
      cargoId: null,
      skillsCount: 0,
      conectoresCount: 0,
      tienePolitica: false,
    });
  });

  it('agrega los totales para el encabezado del diálogo', () => {
    expect(totalesPermisosPendientes(permisos)).toEqual({ agentes: 2, skills: 2, conectores: 1, politicas: 1 });
  });

  it('sin permisos, los totales son cero', () => {
    expect(totalesPermisosPendientes([])).toEqual({ agentes: 0, skills: 0, conectores: 0, politicas: 0 });
  });
});
