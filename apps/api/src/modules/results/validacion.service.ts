import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ContratoResultado, Evidencia, Prisma, Tarea, VeredictoValidacion } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentVerificationService } from '../agents/agent-verification.service';
import type { ValidarResultadoDto } from './dto/validacion.dto';
import { evaluarDeterminista, tieneReglaDeterminista, type ReglaValidacion } from './validacion.rules';

type ContratoConContexto = ContratoResultado & { tarea: Tarea | null; evidencias: Evidencia[] };

/** Resultado de una verificación ya decidida. `final` = aceptación o devolución definitiva del resultado. */
interface Decision {
  veredicto: VeredictoValidacion;
  /** Si el veredicto resuelve el estado del resultado (ACEPTADO/DEVUELTO). `false` deja PENDIENTE_VALIDACION. */
  final: boolean;
  motivo: string | null;
  reglaAplicada: Prisma.InputJsonValue | null;
  /** Para ASISTIDA de resultado de negocio: exige que una persona revise antes de aceptar (ADR 0010 D4). */
  requiereRevisionHumana: boolean;
}

/**
 * Verificación y aceptación del resultado (RF30). Invariante central, garantizado aquí (no solo en BD): el verificador
 * es SIEMPRE distinto del ejecutor. La aceptación exige verificación superada, no que el ejecutor afirme haber
 * terminado (HU15/QA09). La verificación asistida reutiliza la lógica pura de la verificación cruzada del ADR 0010 D4
 * (`AgentVerificationService`), no se reimplementa.
 */
@Injectable()
export class ValidacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: AgentVerificationService,
  ) {}

  async validar(workspaceId: string, contratoId: string, dto: ValidarResultadoDto) {
    const contrato = await this.prisma.contratoResultado.findFirst({
      where: { id: contratoId, workspaceId },
      include: { tarea: true, evidencias: true },
    });
    if (!contrato) throw new NotFoundException('Contrato de resultado no encontrado');
    if (contrato.estado !== 'PENDIENTE_VALIDACION') {
      throw new BadRequestException(
        `Solo se valida un resultado en PENDIENTE_VALIDACION (estado actual: ${contrato.estado})`,
      );
    }

    const ejecutorAgentId = contrato.responsableAgentId ?? contrato.tarea?.responsableAgentId ?? null;
    const duenoEjecutorUserId = contrato.duenoUserId ?? contrato.tarea?.duenoUserId ?? null;
    this.assertVerificadorDistinto(dto, ejecutorAgentId, duenoEjecutorUserId);

    const decision = this.decidir(dto, contrato);

    const siguienteEstado =
      decision.veredicto === 'ACEPTA'
        ? decision.final
          ? 'ACEPTADO'
          : 'PENDIENTE_VALIDACION' // aceptación asistida de resultado de negocio: falta revisión humana
        : 'DEVUELTO_INCUMPLIDO';

    const [validacion] = await this.prisma.$transaction([
      this.prisma.validacionResultado.create({
        data: {
          workspaceId,
          contratoResultadoId: contrato.id,
          modo: dto.modo,
          verificadorAgentId: dto.verificadorAgentId ?? null,
          validadorUserId: dto.validadorUserId ?? null,
          reglaAplicada: decision.reglaAplicada ?? undefined,
          veredicto: decision.veredicto,
          motivo: decision.motivo,
          evidenciaIds: dto.evidenciaIds ?? [],
          version: contrato.version,
        },
      }),
      this.prisma.contratoResultado.update({ where: { id: contrato.id }, data: { estado: siguienteEstado } }),
    ]);

    return {
      validacion,
      estadoResultado: siguienteEstado,
      requiereRevisionHumana: decision.requiereRevisionHumana,
    };
  }

  /** Invariante RF30: el verificador no puede ser el ejecutor (agente) ni el dueño ejecutor (humano). */
  private assertVerificadorDistinto(
    dto: ValidarResultadoDto,
    ejecutorAgentId: string | null,
    duenoEjecutorUserId: string | null,
  ): void {
    if (dto.verificadorAgentId && ejecutorAgentId && dto.verificadorAgentId === ejecutorAgentId) {
      throw new BadRequestException('El verificador no puede ser el agente ejecutor del resultado (RF30)');
    }
    if (dto.validadorUserId && duenoEjecutorUserId && dto.validadorUserId === duenoEjecutorUserId) {
      throw new BadRequestException('El validador humano no puede ser el dueño ejecutor del resultado (RF30)');
    }
    if (dto.modo === 'HUMANA' && !dto.validadorUserId) {
      throw new BadRequestException('La validación humana exige `validadorUserId`');
    }
    if (dto.modo === 'ASISTIDA' && !dto.verificadorAgentId) {
      throw new BadRequestException('La validación asistida exige un `verificadorAgentId` distinto del ejecutor');
    }
    // Un verificador asistido sin ejecutor conocido no puede garantizar la separación: se exige el ejecutor.
    if (dto.modo === 'ASISTIDA' && !ejecutorAgentId) {
      throw new BadRequestException('No se puede verificar de forma asistida sin un ejecutor registrado (RF30)');
    }
  }

  private decidir(dto: ValidarResultadoDto, contrato: ContratoConContexto): Decision {
    const esResultadoNegocio = contrato.tipoResultado === 'RESULTADO_NEGOCIO';
    if (dto.modo === 'DETERMINISTA') return this.decidirDeterminista(dto, contrato);
    if (dto.modo === 'HUMANA') return this.decidirHumana(dto);
    return this.decidirAsistida(dto, esResultadoNegocio);
  }

  private decidirDeterminista(dto: ValidarResultadoDto, contrato: ContratoConContexto): Decision {
    const regla = contrato.reglaValidacion as ReglaValidacion;
    const evidenciaExigida = Array.isArray(contrato.evidenciaExigida) ? (contrato.evidenciaExigida as string[]) : [];
    if (!tieneReglaDeterminista(regla) && evidenciaExigida.length === 0) {
      // Una descripción libre no reemplaza al contrato (RF29): sin regla ni evidencia exigida no hay vía determinista.
      throw new BadRequestException(
        'El contrato no define una regla de validación determinista ni evidencia exigida (RF29)',
      );
    }
    const ctx = {
      ...(dto.contexto ?? {}),
      entradas: contrato.entradas,
      contrato: { indicador: contrato.indicador, resultadoEsperado: contrato.resultadoEsperado },
      tarea: contrato.tarea ? { criterioAceptacion: contrato.tarea.criterioAceptacion } : undefined,
    };
    const tiposPresentes = contrato.evidencias.map((e) => e.tipo);
    const evaluacion = evaluarDeterminista(regla ?? {}, evidenciaExigida, tiposPresentes, ctx);
    const motivo = evaluacion.cumple
      ? 'REGLA_DETERMINISTA_CUMPLE'
      : evaluacion.evidenciaFaltante.length > 0
        ? `EVIDENCIA_FALTANTE:${evaluacion.evidenciaFaltante.join(',')}`
        : 'REGLA_DETERMINISTA_NO_CUMPLE';
    return {
      veredicto: evaluacion.cumple ? 'ACEPTA' : 'DEVUELVE',
      final: true,
      motivo,
      reglaAplicada: {
        rules: regla?.rules ?? [],
        resultados: evaluacion.resultados,
      } as unknown as Prisma.InputJsonValue,
      requiereRevisionHumana: false,
    };
  }

  private decidirHumana(dto: ValidarResultadoDto): Decision {
    if (!dto.veredicto) throw new BadRequestException('La validación humana exige `veredicto`');
    if (dto.veredicto === 'DEVUELVE' && !dto.motivo?.trim()) {
      throw new BadRequestException('Una devolución debe conservar el motivo (HU14)');
    }
    return {
      veredicto: dto.veredicto,
      final: true,
      motivo: dto.motivo?.trim() ?? (dto.veredicto === 'ACEPTA' ? 'ACEPTADA_POR_HUMANO' : null),
      reglaAplicada: null,
      requiereRevisionHumana: false,
    };
  }

  /**
   * Verificación asistida (ADR 0010 D4): reutiliza `parseVerdict`/`resolveIssueOutcome`. Un problema detectado
   * devuelve. Un veredicto OK acepta en tareas informativas; antes de aceptar un resultado de NEGOCIO, exige revisión
   * humana (no se autoacepta): se registra la verificación pero el resultado queda PENDIENTE_VALIDACION.
   */
  private decidirAsistida(dto: ValidarResultadoDto, esResultadoNegocio: boolean): Decision {
    if (!dto.critica?.trim()) {
      throw new BadRequestException('La validación asistida exige el veredicto del verificador en `critica`');
    }
    const { verdict, critique } = this.verification.parseVerdict(dto.critica);
    if (verdict === 'PROBLEMA') {
      const outcome = this.verification.resolveIssueOutcome('auto', esResultadoNegocio);
      return {
        veredicto: 'DEVUELVE',
        final: true,
        motivo: `VERIFICACION_ASISTIDA_PROBLEMA:${outcome.code}:${critique.slice(0, 500)}`,
        reglaAplicada: { modo: 'ASISTIDA', code: outcome.code },
        requiereRevisionHumana: outcome.requiresHumanReview,
      };
    }
    // Veredicto OK: resultado de negocio requiere revisión humana antes de aceptar (no es final).
    return {
      veredicto: 'ACEPTA',
      final: !esResultadoNegocio,
      motivo: esResultadoNegocio ? 'VERIFICACION_ASISTIDA_OK_REQUIERE_HUMANO' : 'VERIFICACION_ASISTIDA_OK',
      reglaAplicada: { modo: 'ASISTIDA', code: 'VERIFICACION_OK' },
      requiereRevisionHumana: esResultadoNegocio,
    };
  }
}
