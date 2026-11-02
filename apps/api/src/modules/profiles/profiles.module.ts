import { Module } from '@nestjs/common';
import { ContactosController } from './contactos.controller';
import { MemoriaController } from './memoria.controller';
import { OrganizacionesController } from './organizaciones.controller';
import { ProfilesService } from './profiles.service';

/**
 * Memoria y perfiles gobernados (ADR 0018 Inc.1): perfiles de contacto/organización y memoria operativa por proceso.
 * Contexto multi-tenant, no concede permisos. El enganche con el correo (Inc.2) y la lógica de memoria (Inc.3) son
 * incrementos posteriores.
 */
@Module({
  controllers: [OrganizacionesController, ContactosController, MemoriaController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
