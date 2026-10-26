import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';

/**
 * Comunidad interna (E11): el "muro" corporativo privado de NEXO. Red social interna para comunicar novedades, pedir
 * apoyo, compartir aprendizajes y coordinar compromisos ligados a tareas. Multi-tenant estricto; contenido de usuario
 * que nunca se expande con plantillas ni se ejecuta.
 */
@Module({
  controllers: [CommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
