import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  AgentVersion,
  EvalCase,
  EvalCaseInput,
  EvalResult,
  EvalResultReviewInput,
  EvalRun,
  EvalRunDetail,
  EvalRunInput,
  Feedback,
  FeedbackInput,
  FeedbackReviewInput,
  FeedbackStatus,
  PromptSuggestion,
  PublishVersionResult,
  SuggestionInput,
  TrainingSummary,
} from './training.models';

/** Fachada tipada del bucle de mejora supervisada (ADR 0004). */
@Injectable({ providedIn: 'root' })
export class TrainingApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string, params?: Record<string, string>) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params }));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }
  private patch<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(`${this.base}${path}`, body));
  }
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // Retroalimentación y supervisión
  sendFeedback = (agentId: string, data: FeedbackInput) => this.post<Feedback>(`/agents/${agentId}/feedback`, data);
  agentFeedback = (agentId: string, status?: FeedbackStatus) =>
    this.get<Feedback[]>(`/agents/${agentId}/feedback`, status ? { status } : undefined);
  workspaceFeedback = (status?: FeedbackStatus) => this.get<Feedback[]>('/feedback', status ? { status } : undefined);
  reviewFeedback = (id: string, data: FeedbackReviewInput) => this.post<Feedback>(`/feedback/${id}/review`, data);

  // Casos de evaluación
  evalCases = (agentId: string) => this.get<EvalCase[]>(`/agents/${agentId}/eval-cases`);
  createEvalCase = (agentId: string, data: EvalCaseInput) => this.post<EvalCase>(`/agents/${agentId}/eval-cases`, data);
  updateEvalCase = (id: string, data: Partial<EvalCaseInput>) => this.patch<EvalCase>(`/eval-cases/${id}`, data);
  deleteEvalCase = (id: string) => this.delete(`/eval-cases/${id}`);

  // Corridas de evaluación
  startEvalRun = (agentId: string, data: EvalRunInput) => this.post<EvalRun>(`/agents/${agentId}/eval-runs`, data);
  evalRuns = (agentId: string) => this.get<EvalRun[]>(`/agents/${agentId}/eval-runs`);
  evalRun = (id: string) => this.get<EvalRunDetail>(`/eval-runs/${id}`);
  reviewEvalResult = (id: string, data: EvalResultReviewInput) => this.patch<EvalResult>(`/eval-results/${id}`, data);

  // Versiones
  versions = (agentId: string) => this.get<AgentVersion[]>(`/agents/${agentId}/versions`);
  createVersion = (agentId: string, note?: string) =>
    this.post<AgentVersion>(`/agents/${agentId}/versions`, note ? { note } : {});
  publishVersion = (agentId: string, versionId: string) =>
    this.post<PublishVersionResult | null>(`/agents/${agentId}/versions/${versionId}/publish`);

  // Sugerencias de mejora
  createSuggestion = (runId: string, data: SuggestionInput) =>
    this.post<PromptSuggestion>(`/eval-runs/${runId}/suggestions`, data);
  suggestions = (agentId: string) => this.get<PromptSuggestion[]>(`/agents/${agentId}/suggestions`);
  applySuggestion = (id: string) => this.post<unknown>(`/suggestions/${id}/apply`);
  rejectSuggestion = (id: string) => this.post<unknown>(`/suggestions/${id}/reject`);

  // Resumen del ciclo
  summary = (agentId: string) => this.get<TrainingSummary>(`/agents/${agentId}/training-summary`);
}
