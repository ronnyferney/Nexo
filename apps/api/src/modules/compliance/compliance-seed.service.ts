import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ReglaValidacionDeclarativa, TipoDatoCumplimiento } from './cumplimiento.resolver';

/**
 * Jurisdicción a la que se acota la activación inicial aprobada por el patrocinador (doc
 * `matriz-cumplimiento-campos.md` §6-bis). Ampliar a otras jurisdicciones (p. ej. "EC") o volverlas comodín (null)
 * es CREAR/EDITAR filas, no tocar código.
 */
export const JURISDICCION_INICIAL = 'CO';

/** Definición plana de una regla transversal a sembrar (el alcance comodín de sector/proceso/riesgo se fija aparte). */
export interface DefinicionReglaTransversal {
  campoClave: string;
  tipoDato: TipoDatoCumplimiento;
  reglaValidacion: ReglaValidacionDeclarativa;
  controlProteccion: string | null;
  descripcion: string;
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

/** Resultado de sembrar un workspace: cuántas reglas se crearon, actualizaron o quedaron sin cambios. */
export interface ResumenSeedWorkspace {
  workspaceId: string;
  creadas: number;
  actualizadas: number;
  sinCambios: number;
}

/**
 * Siembra idempotente de la configuración inicial de la MATRIZ DE CUMPLIMIENTO aprobada por el patrocinador
 * (doc §6-bis · ADR 0020): las 4 reglas transversales con jurisdiccion='CO', resto del alcance comodín y `activa=true`,
 * en modo ASESOR (no bloqueante). NO se ejecuta al arranque: es OPT-IN, vía `npm run compliance:seed` (CLI).
 *
 * Garantías:
 *  - Idempotente: hace UPSERT por la tupla de alcance (workspaceId, campoClave, jurisdiccion, sector, proceso,
 *    nivelRiesgo). Correrlo N veces no duplica; si una definición cambió, actualiza la fila existente.
 *  - Multi-tenant: siempre acotado a un `workspaceId`; `seedTodos` recorre cada workspace por separado.
 *  - No toca el comportamiento de emisión/aceptación de resultados (el motor ya es no bloqueante).
 */
@Injectable()
export class ComplianceSeedService {
  private readonly logger = new Logger(ComplianceSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garantiza las 4 reglas transversales (CO) en un workspace. UPSERT por tupla de alcance: crea las que falten,
   * actualiza las que difieran y deja intactas las ya correctas. No afecta a reglas de otro alcance ni de otro
   * workspace.
   */
  async seedWorkspace(workspaceId: string): Promise<ResumenSeedWorkspace> {
    let creadas = 0;
    let actualizadas = 0;
    let sinCambios = 0;

    for (const def of REGLAS_TRANSVERSALES_CO) {
      // Tupla de alcance que identifica unívocamente la regla transversal (sector/proceso/riesgo = comodín).
      const alcance = {
        workspaceId,
        campoClave: def.campoClave,
        jurisdiccion: JURISDICCION_INICIAL,
        sector: null,
        proceso: null,
        nivelRiesgo: null,
      } satisfies Prisma.ReglaCumplimientoWhereInput;

      const existente = await this.prisma.reglaCumplimiento.findFirst({
        where: alcance,
        orderBy: { createdAt: 'asc' },
      });

      const contenido = {
        tipoDato: def.tipoDato,
        reglaValidacion: def.reglaValidacion as unknown as Prisma.InputJsonValue,
        controlProteccion: def.controlProteccion,
        descripcion: def.descripcion,
        activa: true,
      };

      if (!existente) {
        await this.prisma.reglaCumplimiento.create({
          data: {
            workspaceId,
            campoClave: def.campoClave,
            jurisdiccion: JURISDICCION_INICIAL,
            sector: null,
            proceso: null,
            nivelRiesgo: null,
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
      `Seed matriz de cumplimiento (CO) en workspace ${workspaceId}: ` +
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
    def: DefinicionReglaTransversal,
  ): boolean {
    return (
      existente.tipoDato !== def.tipoDato ||
      existente.controlProteccion !== def.controlProteccion ||
      existente.descripcion !== def.descripcion ||
      existente.activa !== true ||
      JSON.stringify(existente.reglaValidacion ?? null) !== JSON.stringify(def.reglaValidacion)
    );
  }
}
