import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** Política de DataGuard hacia los modelos de IA (ADR 0008 D2). */
export type DataGuardMode = 'off' | 'mask' | 'block';

/** `GET/PUT /admin/data-protection/policy` (ADR 0008 D2 y D7). */
export interface DataPolicy {
  dataGuardMode: DataGuardMode;
  /** Días que se conservan conversaciones y mensajes (null = sin límite). */
  conversationRetentionDays: number | null;
  /** El workspace aún no guardó una política: rigen los valores por defecto. */
  isDefault: boolean;
  platformDefaultRetentionDays: number | null;
  credentials: 'BLOCK';
  categories: { id: string; label: string }[];
}

export interface DataPolicyTest {
  mode: DataGuardMode;
  findings: { category: string; kind: string; start: number; end: number; confidence: number }[];
  blocked: boolean;
  masked: string;
}

/** Protección de datos del workspace (solo ADMIN/OWNER). */
@Injectable({ providedIn: 'root' })
export class DataProtectionApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/admin/data-protection`;

  policy = () => firstValueFrom(this.http.get<DataPolicy>(`${this.base}/policy`));
  updatePolicy = (data: Partial<Pick<DataPolicy, 'dataGuardMode' | 'conversationRetentionDays'>>) =>
    firstValueFrom(this.http.put<DataPolicy>(`${this.base}/policy`, data));
  test = (text: string) => firstValueFrom(this.http.post<DataPolicyTest>(`${this.base}/test`, { text }));
}
