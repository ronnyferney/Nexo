import { Module } from '@nestjs/common';
import { ContactosController } from './contactos.controller';
import { MemoriaController } from './memoria.controller';
import { OrganizacionesController } from './organizaciones.controller';
import { ProfilesEnrichmentService } from './profiles-enrichment.service';
import { ProfilesService } from './profiles.service';

/**
 * Memoria y perfiles gobernados (ADR 0018): perfiles de contacto/organización y memoria operativa por proceso.
 * Contexto multi-tenant, no concede permisos. Inc.2 añade `ProfilesEnrichmentService` (enriquecimiento idempotente
 * desde el correo entrante, lo consume `ChannelsModule`) y las consultas por correo/dominio para la ficha del buzón.
 * La lógica de memoria operativa (Inc.3) es un incremento posterior.
 */
@Module({
  controllers: [OrganizacionesController, ContactosController, MemoriaController],
  providers: [ProfilesService, ProfilesEnrichmentService],
  exports: [ProfilesService, ProfilesEnrichmentService],
})
export class ProfilesModule {}
