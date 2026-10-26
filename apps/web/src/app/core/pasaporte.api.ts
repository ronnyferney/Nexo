import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { PasaporteExport, PasaporteResultado, PasaporteVerificacion } from './pasaporte.models';

/**
 * Fachada tipada del Pasaporte de Resultado (ADR 0014 · E14): emisión, lectura, verificación y exportación de la
 * cadena de custodia verificable de un `ContratoResultado` ACEPTADO. Espeja el contrato del backend
 * (`modules/results/pasaporte.controller`). Las páginas nunca usan `HttpClient`: consumen estos métodos y muestran los
 * errores con `errorMessage()` + `ToastService`. El servidor es el gate real de rol (EDITOR+ para emitir, VIEWER+ para
 * leer/verificar/exportar) y de la invariante de inmutabilidad (append-only).
 */
@Injectable({ providedIn: 'root' })
export class PasaporteApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private httpGet<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private httpPost<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  /** Emite el pasaporte de un contrato ACEPTADO (EDITOR+). 409 si no está ACEPTADO o si no ha cambiado desde el último. */
  emitir = (contratoId: string) => this.httpPost<PasaporteResultado>(`/contracts/${contratoId}/passport`);
  /** Detalle del pasaporte (VIEWER+). 404 si no existe en el workspace. */
  get = (id: string) => this.httpGet<PasaporteResultado>(`/passports/${id}`);
  /** Verificación extremo a extremo: referencias vigentes + ancla + cadena de auditoría. */
  verify = (id: string) => this.httpGet<PasaporteVerificacion>(`/passports/${id}/verify`);
  /** Cuerpo canónico + ancla + instrucciones para que un auditor externo recompute el hash sin datos sensibles. */
  export = (id: string) => this.httpGet<PasaporteExport>(`/passports/${id}/export`);
}
