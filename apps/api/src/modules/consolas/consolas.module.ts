import { Module } from '@nestjs/common';
import { ResultsModule } from '../results/results.module';
import { ConsolaGerencialController } from './consola-gerencial.controller';
import { ConsolaGerencialService } from './consola-gerencial.service';

/**
 * Consolas gerenciales (E12 · vista ejecutiva para dirección). Módulo de SOLO LECTURA que no añade tablas ni migración:
 * agrega sobre datos ya existentes combinando por composición `IndicadoresService` (E10, importado de `ResultsModule`),
 * `ConsolidacionService` (E9) y `AuditService` (E13) —ambos `@Global`— con conteos de estado operativo de gobierno
 * (E6/E7) vía Prisma. No reimplementa ninguna métrica ni abre un libro económico paralelo (ADR 0002 intacto).
 */
@Module({
  imports: [ResultsModule],
  controllers: [ConsolaGerencialController],
  providers: [ConsolaGerencialService],
})
export class ConsolasModule {}
