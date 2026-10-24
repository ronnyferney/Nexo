import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import type { Agent } from './models';
import type {
  AgentExample,
  AgentExampleInput,
  KnowledgeBase,
  KnowledgeBaseInput,
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeSearchHit,
  PromptPreview,
  Routine,
  RoutineInput,
  RoutineRun,
  Skill,
  SkillInput,
} from './studio.models';

/** Fachada tipada de los endpoints del Estudio de agentes (ADR 0003). */
@Injectable({ providedIn: 'root' })
export class StudioApi {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.base}${path}`));
  }
  private post<T>(path: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }
  private patch<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.patch<T>(`${this.base}${path}`, body));
  }
  private put<T>(path: string, body: unknown) {
    return firstValueFrom(this.http.put<T>(`${this.base}${path}`, body));
  }
  private delete<T>(path: string) {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`));
  }

  // Agente: skills, conocimiento, ejemplos y vista previa del prompt
  setAgentSkills = (agentId: string, skillIds: string[]) => this.put<Agent>(`/agents/${agentId}/skills`, { skillIds });
  setAgentKnowledge = (agentId: string, knowledgeBaseIds: string[], writableIds: string[] = []) =>
    this.put<Agent>(`/agents/${agentId}/knowledge`, { knowledgeBaseIds, writableIds });
  examples = (agentId: string) => this.get<AgentExample[]>(`/agents/${agentId}/examples`);
  createExample = (agentId: string, data: AgentExampleInput) => this.post<AgentExample>(`/agents/${agentId}/examples`, data);
  deleteExample = (agentId: string, exampleId: string) => this.delete(`/agents/${agentId}/examples/${exampleId}`);
  promptPreview = (agentId: string) => this.get<PromptPreview>(`/agents/${agentId}/prompt-preview`);

  // Skills
  skills = () => this.get<Skill[]>('/skills');
  skill = (id: string) => this.get<Skill>(`/skills/${id}`);
  createSkill = (data: SkillInput) => this.post<Skill>('/skills', data);
  updateSkill = (id: string, data: Partial<SkillInput>) => this.patch<Skill>(`/skills/${id}`, data);
  deleteSkill = (id: string) => this.delete(`/skills/${id}`);

  // Conocimiento
  knowledgeBases = () => this.get<KnowledgeBase[]>('/knowledge-bases');
  knowledgeBase = (id: string) => this.get<KnowledgeBase>(`/knowledge-bases/${id}`);
  createKnowledgeBase = (data: KnowledgeBaseInput) => this.post<KnowledgeBase>('/knowledge-bases', data);
  updateKnowledgeBase = (id: string, data: Partial<KnowledgeBaseInput>) => this.patch<KnowledgeBase>(`/knowledge-bases/${id}`, data);
  deleteKnowledgeBase = (id: string) => this.delete(`/knowledge-bases/${id}`);
  documents = (kbId: string) => this.get<KnowledgeDocument[]>(`/knowledge-bases/${kbId}/documents`);
  addDocument = (kbId: string, data: KnowledgeDocumentInput) =>
    this.post<KnowledgeDocument>(`/knowledge-bases/${kbId}/documents`, data);
  uploadDocument = (kbId: string, file: File, title?: string) => {
    const form = new FormData();
    form.append('file', file, file.name);
    if (title) form.append('title', title);
    return this.post<KnowledgeDocument>(`/knowledge-bases/${kbId}/documents/upload`, form);
  };
  deleteDocument = (kbId: string, docId: string) => this.delete(`/knowledge-bases/${kbId}/documents/${docId}`);
  searchKnowledge = (kbId: string, query: string, limit?: number) =>
    this.post<KnowledgeSearchHit[]>(`/knowledge-bases/${kbId}/search`, limit ? { query, limit } : { query });

  // Rutinas
  routines = () => this.get<Routine[]>('/routines');
  agentRoutines = (agentId: string) => this.get<Routine[]>(`/agents/${agentId}/routines`);
  createRoutine = (agentId: string, data: RoutineInput) => this.post<Routine>(`/agents/${agentId}/routines`, data);
  updateRoutine = (id: string, data: Partial<RoutineInput>) => this.patch<Routine>(`/routines/${id}`, data);
  deleteRoutine = (id: string) => this.delete(`/routines/${id}`);
  runRoutine = (id: string) => this.post<RoutineRun>(`/routines/${id}/run`);
  routineRuns = (id: string) => this.get<RoutineRun[]>(`/routines/${id}/runs`);
}
