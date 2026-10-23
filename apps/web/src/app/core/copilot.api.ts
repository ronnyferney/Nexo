import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import type {
  CopilotApplyResult,
  CopilotFeedbackInput,
  CopilotProposal,
  CopilotQuota,
  CopilotSession,
  CopilotSessionInput,
  CopilotSessionRef,
  CopilotStreamEvent,
} from './copilot.models';

/** Error HTTP del streaming con el código de estado (p. ej. 402/429 cuando se agota el cupo). */
export class CopilotStreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Fachada de Nexo Copilot (ADR 0006). */
@Injectable({ providedIn: 'root' })
export class CopilotApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = environment.apiUrl;

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  createSession = (data: CopilotSessionInput) => this.post<CopilotSessionRef>('/copilot/sessions', data);
  session = (id: string) => this.get<CopilotSession>(`/copilot/sessions/${id}`);
  proposal = (id: string) => this.get<CopilotProposal>(`/copilot/proposals/${id}`);
  applyProposal = (id: string) => this.post<CopilotApplyResult>(`/copilot/proposals/${id}/apply`);
  discardProposal = (id: string) => this.post<CopilotProposal | null>(`/copilot/proposals/${id}/discard`);
  quota = () => this.get<CopilotQuota>('/copilot/quota');
  feedback = (messageId: string, data: CopilotFeedbackInput) => this.post<unknown>(`/copilot/messages/${messageId}/feedback`, data);

  /** Mensaje con streaming SSE sobre fetch; mismo formato y parser que el chat de agentes. */
  async sendMessage(
    sessionId: string,
    message: string,
    onEvent: (e: CopilotStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${this.base}/copilot/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.auth.token}` },
      body: JSON.stringify({ message, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) {
      if (res.status === 401) this.auth.logout();
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new CopilotStreamError(Array.isArray(err.message) ? err.message.join(', ') : err.message, res.status);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (event && data) onEvent({ ...JSON.parse(data), type: event } as CopilotStreamEvent);
      }
    }
  }
}
