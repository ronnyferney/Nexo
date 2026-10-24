import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marca un endpoint como accesible sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const OPTIONAL_AUTH = 'optionalAuth';
/**
 * Endpoint accesible sin autenticación que, si llega una credencial, la valida y expone `@CurrentAuth()` (p. ej.
 * aceptar una invitación con la cuenta ya iniciada). Una credencial inválida responde 401 igual que en el resto.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
