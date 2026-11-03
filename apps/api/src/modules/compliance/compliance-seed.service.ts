import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { NivelRiesgo, ReglaValidacionDeclarativa, TipoDatoCumplimiento } from './cumplimiento.resolver';

/**
 * Jurisdicción a la que se acota la activación inicial aprobada por el patrocinador (doc
 * `matriz-cumplimiento-campos.md` §6-bis). Ampliar a otras jurisdicciones (p. ej. "EC") o volverlas comodín (null)
 * es CREAR/EDITAR filas, no tocar código.
 */
export const JURISDICCION_INICIAL = 'CO';

/** Segunda jurisdicción preparada como catálogo base, INACTIVA hasta revisión jurídica (autorización 2026-11-03). */
export const JURISDICCION_SIGUIENTE = 'EC';

/** Definición plana de una regla transversal a sembrar (el alcance comodín de sector/proceso/riesgo se fija aparte). */
export interface DefinicionReglaTransversal {
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  reglaValidacion: ReglaValidacionDeclarativa;
  controlProteccion: string | null;
  descripcion: string;
}

/**
 * Definición COMPLETA de una regla a sembrar: alcance explícito (jurisdiccion/sector/proceso/nivelRiesgo) + contenido
 * + el flag `activa` POR DEFINICIÓN. Permite sembrar catálogos activos (p. ej. cobranza CO) y catálogos preparados pero
 * INACTIVOS (salud/retail/EC) en la misma corrida, sin dispersar `if` por sector en el código: todo es DATO.
 */
export interface DefinicionReglaCumplimiento {
  jurisdiccion: string | null;
  sector: string | null;
  proceso: string | null;
  nivelRiesgo: NivelRiesgo | null;
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  reglaValidacion: ReglaValidacionDeclarativa | null;
  controlProteccion: string | null;
  descripcion: string;
  activa: boolean;
}

/**
 * Las 4 reglas TRANSVERSALES aprobadas (doc `matriz-cumplimiento-campos.md` §3 y §6-bis). Alcance: jurisdiccion='CO';
 * sector/proceso/nivelRiesgo = comodín (null); nacen ACTIVAS. Son controles técnicos configurables y ASESORES (no
 * bloqueantes): informan faltantes pero no impiden emitir ni aceptar resultados. No afirman conformidad con ninguna
 * norma. Todo es DATO: añadir o cambiar reglas es editar esta tabla, no dispersar `if` por sector en el código.
 */
export const REGLAS_TRANSVERSALES_CO: ReadonlyArray<DefinicionReglaTransversal> = [
  {
    campoClave: 'clasificacionDatos',
    tipoDato: 'TEXTO',
    reglaValidacion: { enum: ['publico', 'interno', 'confidencial', 'reservado'] },
    controlProteccion: 'minimización',
    descripcion:
      'Clasificación de la sensibilidad del contenido del resultado (público, interno, confidencial o reservado) ' +
      'para aplicar el principio de minimización de datos.',
  },
  {
    campoClave: 'jurisdiccionAplicable',
    tipoDato: 'TEXTO',
    reglaValidacion: { requerido: true },
    controlProteccion: null,
    descripcion: 'Marco jurisdiccional bajo el cual se produjo y debe interpretarse el resultado.',
  },
  {
    campoClave: 'baseLegalTratamiento',
    tipoDato: 'TEXTO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'base-legal',
    descripcion: 'Base legal invocada para el tratamiento de datos personales asociado al resultado.',
  },
  {
    campoClave: 'supervisionHumanaRegistrada',
    tipoDato: 'BOOLEANO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'supervisión-humana',
    descripcion: 'Constancia de intervención y supervisión humana registrada en decisiones con impacto.',
  },
];

/**
 * Catálogo del SECTOR COBRANZA para Colombia (doc §4.1, financiero / proceso «cobranza»), jurisdiccion='CO'. ACTIVO en
 * modo ASESOR (no bloqueante) por autorización del patrocinador (2026-11-03): informa faltantes, no impide emitir. El
 * alcance sector/proceso/riesgo se declara por regla; «la más específica suma» lo resuelve el motor.
 */
export const REGLAS_COBRANZA_CO: ReadonlyArray<DefinicionReglaCumplimiento> = [
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'financiero',
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'identificadorFiscal',
    tipoDato: 'TEXTO',
    reglaValidacion: { requerido: true, patron: '^[0-9]{10,13}$' },
    controlProteccion: 'seudonimización',
    descripcion:
      'Identificador fiscal del titular asociado al resultado (10 a 13 dígitos), tratado bajo seudonimización.',
    activa: true,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'financiero',
    proceso: 'cobranza',
    nivelRiesgo: null,
    campoClave: 'consentimientoContacto',
    tipoDato: 'BOOLEANO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'consentimiento',
    descripcion: 'Constancia de consentimiento del titular para ser contactado en la gestión de cobranza.',
    activa: true,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'financiero',
    proceso: 'cobranza',
    nivelRiesgo: null,
    campoClave: 'horarioContactoPermitido',
    tipoDato: 'BOOLEANO',
    reglaValidacion: { requerido: true },
    controlProteccion: null,
    descripcion: 'Confirmación de que el contacto de cobranza se realiza dentro del horario permitido.',
    activa: true,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'financiero',
    proceso: 'cobranza',
    nivelRiesgo: 'ALTO',
    campoClave: 'revisionHumanaPrevia',
    tipoDato: 'BOOLEANO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'supervisión-humana',
    descripcion:
      'Constancia de revisión humana previa en gestiones de cobranza de riesgo ALTO antes de actuar sobre el titular.',
    activa: true,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'financiero',
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'retencionEvidenciaDias',
    tipoDato: 'NUMERO',
    reglaValidacion: { min: 365, max: 3650 },
    controlProteccion: 'retención',
    descripcion: 'Días de retención de la evidencia de la gestión financiera (entre 365 y 3650).',
    activa: true,
  },
];

/**
 * Catálogo del SECTOR SALUD (doc §4.2), jurisdiccion='CO'. PREPARADO pero INACTIVO (`activa=false`) hasta validación del
 * patrocinador (autorización 2026-11-03). Se siembra para tenerlo listo; no exige nada mientras esté inactivo.
 */
export const REGLAS_SALUD: ReadonlyArray<DefinicionReglaCumplimiento> = [
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'salud',
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'consentimientoDatosPersonales',
    tipoDato: 'BOOLEANO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'consentimiento',
    descripcion: 'Constancia de consentimiento del titular para el tratamiento de sus datos personales en salud.',
    activa: false,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'salud',
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'categoriaDatoSensible',
    tipoDato: 'TEXTO',
    reglaValidacion: { enum: ['salud', 'genetico', 'biometrico'] },
    controlProteccion: 'datos-sensibles',
    descripcion: 'Categoría del dato sensible tratado (salud, genético o biométrico).',
    activa: false,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'salud',
    proceso: 'onboarding',
    nivelRiesgo: null,
    campoClave: 'baseLegalTratamiento',
    tipoDato: 'TEXTO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'base-legal',
    descripcion: 'Base legal invocada para el tratamiento de datos de salud durante el onboarding del titular.',
    activa: false,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'salud',
    proceso: null,
    nivelRiesgo: 'ALTO',
    campoClave: 'evaluacionImpactoRealizada',
    tipoDato: 'BOOLEANO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'evaluación-impacto',
    descripcion: 'Constancia de evaluación de impacto realizada en tratamientos de datos de salud de riesgo ALTO.',
    activa: false,
  },
];

/**
 * Catálogo del SECTOR RETAIL (doc §4.3), jurisdiccion='CO'. PREPARADO pero INACTIVO (`activa=false`) hasta validación
 * del patrocinador (autorización 2026-11-03). Se siembra para tenerlo listo; no exige nada mientras esté inactivo.
 */
export const REGLAS_RETAIL: ReadonlyArray<DefinicionReglaCumplimiento> = [
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'retail',
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'clasificacionDatos',
    tipoDato: 'TEXTO',
    reglaValidacion: { enum: ['publico', 'interno', 'confidencial'] },
    controlProteccion: 'minimización',
    descripcion: 'Clasificación de la sensibilidad del dato en retail (público, interno o confidencial).',
    activa: false,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'retail',
    proceso: 'marketing',
    nivelRiesgo: null,
    campoClave: 'consentimientoMarketing',
    tipoDato: 'BOOLEANO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'consentimiento',
    descripcion: 'Constancia de consentimiento del titular para recibir comunicaciones de marketing.',
    activa: false,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'retail',
    proceso: 'marketing',
    nivelRiesgo: null,
    campoClave: 'canalContacto',
    tipoDato: 'TEXTO',
    reglaValidacion: { enum: ['correo', 'whatsapp', 'sms'] },
    controlProteccion: null,
    descripcion: 'Canal de contacto autorizado para el marketing (correo, whatsapp o sms).',
    activa: false,
  },
  {
    jurisdiccion: JURISDICCION_INICIAL,
    sector: 'retail',
    proceso: null,
    nivelRiesgo: null,
    campoClave: 'politicaEliminacion',
    tipoDato: 'TEXTO',
    reglaValidacion: { requerido: true },
    controlProteccion: 'eliminación-segura',
    descripcion: 'Política de eliminación segura de los datos del titular aplicable en retail.',
    activa: false,
  },
];

/**
 * Catálogo TRANSVERSAL para ECUADOR (doc §3), jurisdiccion='EC'. Réplica de los 4 campos transversales como base de la
 * próxima jurisdicción; PREPARADO pero INACTIVO (`activa=false`) hasta revisión jurídica (autorización 2026-11-03).
 */
export const REGLAS_TRANSVERSALES_EC: ReadonlyArray<DefinicionReglaCumplimiento> = REGLAS_TRANSVERSALES_CO.map((r) => ({
  jurisdiccion: JURISDICCION_SIGUIENTE,
  sector: null,
  proceso: null,
  nivelRiesgo: null,
  campoClave: r.campoClave,
  tipoDato: r.tipoDato,
  reglaValidacion: r.reglaValidacion,
  controlProteccion: r.controlProteccion,
  descripcion: r.descripcion,
  activa: false,
}));

/** Reglas transversales CO como definición COMPLETA (jurisdiccion='CO', resto comodín, ACTIVAS). */
export const DEFINICIONES_TRANSVERSALES_CO: ReadonlyArray<DefinicionReglaCumplimiento> = REGLAS_TRANSVERSALES_CO.map(
  (r) => ({
    jurisdiccion: JURISDICCION_INICIAL,
    sector: null,
    proceso: null,
    nivelRiesgo: null,
    campoClave: r.campoClave,
    tipoDato: r.tipoDato,
    reglaValidacion: r.reglaValidacion,
    controlProteccion: r.controlProteccion,
    descripcion: r.descripcion,
    activa: true,
  }),
);

/**
 * Conjunto COMPLETO que siembra el seed, en orden determinista: transversales CO (activas), cobranza CO (activas),
 * salud (inactivas), retail (inactivas) y transversales EC (inactivas). Cada fila lleva su propio `activa`, de modo que
 * una sola corrida deja activo lo aprobado e inactivo lo preparado. Añadir reglas o jurisdicciones es editar esta tabla.
 */
export const DEFINICIONES_SEED: ReadonlyArray<DefinicionReglaCumplimiento> = [
  ...DEFINICIONES_TRANSVERSALES_CO,
  ...REGLAS_COBRANZA_CO,
  ...REGLAS_SALUD,
  ...REGLAS_RETAIL,
  ...REGLAS_TRANSVERSALES_EC,
];

/** Resultado de sembrar un workspace: cuántas reglas se crearon, actualizaron o quedaron sin cambios. */
export interface ResumenSeedWorkspace {
  workspaceId: string;
  creadas: number;
  actualizadas: number;
  sinCambios: number;
}

/**
 * Siembra idempotente de la configuración inicial de la MATRIZ DE CUMPLIMIENTO aprobada por el patrocinador
 * (doc §6-bis · ADR 0020 · autorización 2026-11-03). Siembra en una sola corrida:
 *  - Transversales CO + cobranza CO → `activa=true` (modo ASESOR, no bloqueante).
 *  - Salud, retail y transversales EC → `activa=false` (preparados, pendientes de validación/revisión jurídica).
 * NO se ejecuta al arranque: es OPT-IN, vía `npm run compliance:seed` (CLI).
 *
 * Garantías:
 *  - Idempotente: hace UPSERT por la tupla de alcance (workspaceId, campoClave, jurisdiccion, sector, proceso,
 *    nivelRiesgo). Correrlo N veces no duplica; si una definición cambió, actualiza la fila existente (incluido `activa`).
 *  - Multi-tenant: siempre acotado a un `workspaceId`; `seedTodos` recorre cada workspace por separado.
 *  - No toca el comportamiento de emisión/aceptación de resultados (el motor ya es no bloqueante).
 */
@Injectable()
export class ComplianceSeedService {
  private readonly logger = new Logger(ComplianceSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garantiza el conjunto completo de reglas (ver `DEFINICIONES_SEED`) en un workspace. UPSERT por tupla de alcance:
   * crea las que falten, actualiza las que difieran (respetando el `activa` de cada definición) y deja intactas las ya
   * correctas. No afecta a reglas de otro alcance ni de otro workspace.
   */
  async seedWorkspace(workspaceId: string): Promise<ResumenSeedWorkspace> {
    let creadas = 0;
    let actualizadas = 0;
    let sinCambios = 0;

    for (const def of DEFINICIONES_SEED) {
      // Tupla de alcance que identifica unívocamente la regla (dimensiones no provistas = comodín null).
      const alcance = {
        workspaceId,
        campoClave: def.campoClave,
        jurisdiccion: def.jurisdiccion,
        sector: def.sector,
        proceso: def.proceso,
        nivelRiesgo: def.nivelRiesgo,
      } satisfies Prisma.ReglaCumplimientoWhereInput;

      const existente = await this.prisma.reglaCumplimiento.findFirst({
        where: alcance,
        orderBy: { createdAt: 'asc' },
      });

      const contenido = {
        tipoDato: def.tipoDato,
        reglaValidacion: (def.reglaValidacion ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue,
        controlProteccion: def.controlProteccion,
        descripcion: def.descripcion,
        activa: def.activa,
      };

      if (!existente) {
        await this.prisma.reglaCumplimiento.create({
          data: {
            workspaceId,
            campoClave: def.campoClave,
            jurisdiccion: def.jurisdiccion,
            sector: def.sector,
            proceso: def.proceso,
            nivelRiesgo: def.nivelRiesgo,
            ...contenido,
          },
        });
        creadas += 1;
      } else if (this.difiere(existente, def)) {
        await this.prisma.reglaCumplimiento.update({ where: { id: existente.id }, data: contenido });
        actualizadas += 1;
      } else {
        sinCambios += 1;
      }
    }

    const resumen: ResumenSeedWorkspace = { workspaceId, creadas, actualizadas, sinCambios };
    this.logger.log(
      `Seed matriz de cumplimiento en workspace ${workspaceId}: ` +
        `${creadas} creada(s), ${actualizadas} actualizada(s), ${sinCambios} sin cambios.`,
    );
    return resumen;
  }

  /** Aplica el seed a TODOS los workspaces existentes (uno por uno). Devuelve el resumen por workspace. */
  async seedTodos(): Promise<ResumenSeedWorkspace[]> {
    const workspaces = await this.prisma.workspace.findMany({ select: { id: true } });
    const resultados: ResumenSeedWorkspace[] = [];
    for (const ws of workspaces) {
      resultados.push(await this.seedWorkspace(ws.id));
    }
    return resultados;
  }

  /** ¿La fila existente difiere de la definición aprobada? (determina si hay que actualizar). */
  private difiere(
    existente: {
      tipoDato: string;
      reglaValidacion: Prisma.JsonValue;
      controlProteccion: string | null;
      descripcion: string | null;
      activa: boolean;
    },
    def: DefinicionReglaCumplimiento,
  ): boolean {
    return (
      existente.tipoDato !== def.tipoDato ||
      existente.controlProteccion !== def.controlProteccion ||
      existente.descripcion !== def.descripcion ||
      existente.activa !== def.activa ||
      jsonEstable(existente.reglaValidacion ?? null) !== jsonEstable(def.reglaValidacion ?? null)
    );
  }
}

/**
 * Serialización JSON determinista con claves ordenadas: Postgres `jsonb` reordena las claves al almacenar, por lo que
 * comparar la regla de validación con `JSON.stringify` directo daría falsos positivos (la fila «difiere» en cada corrida
 * y rompería la idempotencia). Ordenando las claves de forma recursiva la comparación es insensible al orden.
 */
function jsonEstable(valor: unknown): string {
  const ordenar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordenar);
    if (v && typeof v === 'object') {
      const entrada = v as Record<string, unknown>;
      const ordenado: Record<string, unknown> = {};
      for (const k of Object.keys(entrada).sort()) ordenado[k] = ordenar(entrada[k]);
      return ordenado;
    }
    return v;
  };
  return JSON.stringify(ordenar(valor));
}
