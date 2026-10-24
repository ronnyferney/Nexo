import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { Agent, Connector, Execution, NodeType, StepLog, Workflow, WorkflowEdge, WorkflowNode } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { type NodeTestResult, WorkflowsApi, type WorkflowVersionInfo } from '../../core/workflows.api';
import { IconComponent } from '../../shared/icon.component';
import { JsonEditorComponent } from '../../shared/json-editor.component';
import { TemplateRefPipe } from '../../shared/template-ref.pipe';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { NODE_CATALOG, NODE_H, NODE_W, nodeMeta, OPERATORS, validateGraph } from './node-catalog';
import {
  type InputField,
  inputFieldsProblem,
  inputHints,
  INPUT_FIELD_TYPES,
  MAX_INPUT_FIELDS,
  sampleInput,
  typeLabel,
} from './workflow-input';

type Drag =
  | { kind: 'node'; id: string; dx: number; dy: number }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'edge'; source: string; handle?: string };

const TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED'];

/** Datos fijados de un nodo previo para «Probar este nodo». */
interface PinnedEntry {
  on: boolean;
  value: unknown;
}

@Component({
  selector: 'nx-workflow-builder',
  imports: [DatePipe, FormsModule, RouterLink, IconComponent, JsonEditorComponent, StatusBadgeComponent, TemplateRefPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workflow-builder.page.html',
  styleUrl: './workflow-builder.page.scss',
})
export class WorkflowBuilderPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly wfApi = inject(WorkflowsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);
  readonly id = input.required<string>();
  private readonly canvas = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  readonly catalog = NODE_CATALOG;
  readonly operators = OPERATORS;
  readonly meta = nodeMeta;
  /** Variante tolerante para definiciones históricas con tipos desconocidos. */
  readonly metaOf = (type: string) => NODE_CATALOG.find((n) => n.type === type);
  readonly W = NODE_W;
  readonly H = NODE_H;

  readonly workflow = signal<Workflow | null>(null);
  readonly nodes = signal<WorkflowNode[]>([]);
  readonly edges = signal<WorkflowEdge[]>([]);
  readonly selectedNodeId = signal<string | null>(null);
  readonly selectedEdgeId = signal<string | null>(null);
  readonly pan = signal({ x: 40, y: 40 });
  readonly zoom = signal(1);
  readonly pending = signal<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly panel = signal<'node' | 'run' | 'settings' | 'versions'>('settings');
  /** Primer problema estructural del grafo (bloquea Guardar). */
  readonly inputFieldsError = computed(() => inputFieldsProblem(this.nodes()));
  readonly graphError = computed(() => validateGraph(this.nodes(), this.edges()) ?? this.inputFieldsError());

  // Datos de entrada (P2): esquema del disparador + campos que usan las plantillas.
  readonly inputTypes = INPUT_FIELD_TYPES;
  readonly maxInputFields = MAX_INPUT_FIELDS;
  readonly typeLabel = typeLabel;
  readonly runInput = signal<unknown>({});
  readonly hints = computed(() => inputHints(this.nodes(), this.runInput()));
  /** Campos que usan las plantillas y no están declarados en el disparador (para declararlos de un clic). */
  readonly undeclaredRefs = computed(() => this.hints().referenced);
  /** Requeridos ausentes o tipos incorrectos: la API respondería 400, así que se bloquea «Ejecutar ahora». */
  readonly runBlocked = computed(() => this.hints().missingRequired.length > 0 || this.hints().invalid.length > 0);
  /** Hay campos detectados (declarados o en plantillas) que aún no aparecen en el JSON de prueba. */
  readonly canFillSample = computed(() => {
    const cur = this.runInput();
    const sample = sampleInput(this.hints(), cur);
    return Object.keys(sample).length > Object.keys(cur && typeof cur === 'object' ? cur : {}).length;
  });

  /** Otros flujos del workspace (sub-flujos, bucles y flujo de error). */
  readonly allWorkflows = signal<Workflow[]>([]);
  readonly otherWorkflows = computed(() => this.allWorkflows().filter((w) => w.id !== this.id()));

  // Historial de versiones
  readonly versions = signal<WorkflowVersionInfo[] | null>(null);
  readonly versionsLoading = signal(false);
  readonly previewVersion = signal<number | null>(null);
  readonly restoring = signal<number | null>(null);

  // Probar un nodo (pinned data)
  readonly testOpen = signal(false);
  readonly testing = signal(false);
  readonly testResult = signal<NodeTestResult | null>(null);
  readonly testError = signal<string | null>(null);
  readonly pinned = signal<Record<string, PinnedEntry>>({});
  testInput: unknown = {};

  readonly connectors = signal<Connector[]>([]);
  readonly agents = signal<Agent[]>([]);
  readonly execution = signal<Execution | null>(null);
  readonly stepByNode = computed(() => new Map((this.execution()?.steps ?? []).map((s) => [s.nodeId, s] as [string, StepLog])));

  readonly selectedNode = computed(() => this.nodes().find((n) => n.id === this.selectedNodeId()) ?? null);
  readonly upstream = computed(() => {
    const target = this.selectedNodeId();
    if (!target) return [];
    const seen = new Set<string>();
    const stack = [target];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of this.edges()) if (e.target === cur && !seen.has(e.source)) (seen.add(e.source), stack.push(e.source));
    }
    return this.nodes().filter((n) => seen.has(n.id));
  });

  name = '';
  description = '';
  schedule = '';
  errorWorkflowId: string | null = null;
  private drag: Drag | null = null;
  private poll?: ReturnType<typeof setInterval>;

  async ngOnInit() {
    const [wf, connectors, agents, workflows] = await Promise.all([
      this.api.workflow(this.id()),
      this.api.connectors(),
      this.api.agents(),
      this.api.workflows().catch(() => [] as Workflow[]),
    ]);
    this.connectors.set(await Promise.all(connectors.map((c) => this.api.connector(c.id))));
    this.agents.set(agents);
    this.allWorkflows.set(workflows);
    this.apply(wf);
    this.fillSample();
    setTimeout(() => this.fitView());
  }

  ngOnDestroy() {
    clearInterval(this.poll);
  }

  private apply(wf: Workflow) {
    this.workflow.set(wf);
    this.name = wf.name;
    this.description = wf.description ?? '';
    this.schedule = wf.schedule ?? '';
    this.errorWorkflowId = wf.errorWorkflowId ?? null;
    this.nodes.set(structuredClone(wf.definition?.nodes ?? []));
    this.edges.set(structuredClone(wf.definition?.edges ?? []));
    this.dirty.set(false);
  }

  // ---------- Edición del grafo ----------
  addNode(type: NodeType) {
    if (type === 'trigger' && this.nodes().some((n) => n.type === 'trigger')) {
      this.toast.info('El flujo ya tiene un disparador');
      return;
    }
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    const z = this.zoom();
    const offset = (this.nodes().length % 6) * 24;
    const node: WorkflowNode = {
      id: `${type}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      name: nodeMeta(type).label,
      position: { x: (rect.width / 2 - this.pan().x) / z - NODE_W / 2 + offset, y: (rect.height / 2 - this.pan().y) / z - NODE_H / 2 + offset },
      config: structuredClone(nodeMeta(type).defaults),
    };
    this.nodes.update((n) => [...n, node]);
    this.select(node.id);
    this.dirty.set(true);
  }

  select(id: string | null) {
    if (id !== this.selectedNodeId()) this.closeTest();
    this.selectedNodeId.set(id);
    this.selectedEdgeId.set(null);
    this.panel.set(id ? 'node' : 'settings');
  }

  updateNode(patch: Partial<WorkflowNode>) {
    const id = this.selectedNodeId();
    this.nodes.update((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    this.dirty.set(true);
  }

  updateConfig(patch: Record<string, unknown>) {
    const node = this.selectedNode();
    if (node) this.updateNode({ config: { ...node.config, ...patch } });
  }

  deleteSelected() {
    const nodeId = this.selectedNodeId();
    const edgeId = this.selectedEdgeId();
    if (nodeId) {
      this.nodes.update((ns) => ns.filter((n) => n.id !== nodeId));
      this.edges.update((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
      this.select(null);
    } else if (edgeId) {
      this.edges.update((es) => es.filter((e) => e.id !== edgeId));
      this.selectedEdgeId.set(null);
    } else return;
    this.dirty.set(true);
  }

  /** Duplica el nodo seleccionado (sin conexiones) con un desplazamiento de 32 px. */
  duplicateSelected() {
    const src = this.selectedNode();
    if (!src || !this.auth.canEdit()) return;
    if (src.type === 'trigger') {
      this.toast.info('El disparador no se puede duplicar: el flujo admite uno solo');
      return;
    }
    const copy: WorkflowNode = {
      ...structuredClone(src),
      id: `${src.type}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${src.name} (copia)`,
      position: { x: src.position.x + 32, y: src.position.y + 32 },
    };
    this.nodes.update((ns) => [...ns, copy]);
    this.select(copy.id);
    this.dirty.set(true);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected();
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      this.duplicateSelected();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void this.save();
    }
  }

  // ---------- Interacción con el canvas ----------
  private toCanvas(e: PointerEvent) {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { x: (e.clientX - rect.left - this.pan().x) / this.zoom(), y: (e.clientY - rect.top - this.pan().y) / this.zoom() };
  }

  onCanvasDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.select(null);
    this.drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: this.pan().x, panY: this.pan().y };
  }

  onNodeDown(e: PointerEvent, node: WorkflowNode) {
    e.stopPropagation();
    this.select(node.id);
    const p = this.toCanvas(e);
    this.drag = { kind: 'node', id: node.id, dx: p.x - node.position.x, dy: p.y - node.position.y };
  }

  onPortDown(e: PointerEvent, node: WorkflowNode, handle?: string) {
    e.stopPropagation();
    this.drag = { kind: 'edge', source: node.id, handle };
    const start = this.outPort(node, handle);
    this.pending.set({ x1: start.x, y1: start.y, x2: start.x, y2: start.y });
  }

  onInputPortUp(e: PointerEvent, node: WorkflowNode) {
    if (this.drag?.kind !== 'edge') return;
    e.stopPropagation();
    const { source, handle } = this.drag;
    const exists = this.edges().some((x) => x.source === source && x.target === node.id && x.sourceHandle === handle);
    if (source !== node.id && node.type !== 'trigger' && !exists) {
      this.edges.update((es) => [...es, { id: `e_${Math.random().toString(36).slice(2, 8)}`, source, target: node.id, sourceHandle: handle }]);
      this.dirty.set(true);
    }
    this.endDrag();
  }

  @HostListener('document:pointermove', ['$event'])
  onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pan') {
      this.pan.set({ x: d.panX + e.clientX - d.startX, y: d.panY + e.clientY - d.startY });
    } else if (d.kind === 'node') {
      const p = this.toCanvas(e);
      const x = Math.round((p.x - d.dx) / 8) * 8;
      const y = Math.round((p.y - d.dy) / 8) * 8;
      this.nodes.update((ns) => ns.map((n) => (n.id === d.id ? { ...n, position: { x, y } } : n)));
      this.dirty.set(true);
    } else {
      const p = this.toCanvas(e);
      this.pending.update((l) => (l ? { ...l, x2: p.x, y2: p.y } : l));
    }
  }

  @HostListener('document:pointerup')
  endDrag() {
    this.drag = null;
    this.pending.set(null);
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    const z = this.zoom();
    const next = Math.min(1.8, Math.max(0.4, z * (e.deltaY < 0 ? 1.1 : 0.9)));
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    this.pan.update((p) => ({ x: mx - ((mx - p.x) * next) / z, y: my - ((my - p.y) * next) / z }));
    this.zoom.set(next);
  }

  /** Ajusta zoom y desplazamiento para mostrar todo el grafo. */
  fitView() {
    const nodes = this.nodes();
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    if (!nodes.length || !rect.width) return;
    const minX = Math.min(...nodes.map((n) => n.position.x));
    const minY = Math.min(...nodes.map((n) => n.position.y));
    const maxX = Math.max(...nodes.map((n) => n.position.x + NODE_W));
    const maxY = Math.max(...nodes.map((n) => n.position.y + NODE_H));
    const pad = 60;
    const z = Math.min(1.2, Math.max(0.4, Math.min((rect.width - pad * 2) / (maxX - minX), (rect.height - pad * 2) / (maxY - minY))));
    this.zoom.set(z);
    this.pan.set({ x: (rect.width - (maxX - minX) * z) / 2 - minX * z, y: (rect.height - (maxY - minY) * z) / 2 - minY * z });
  }

  // ---------- Geometría ----------
  outPort(n: WorkflowNode, handle?: string) {
    const dy = handle === 'true' ? NODE_H * 0.32 : handle === 'false' ? NODE_H * 0.72 : NODE_H / 2;
    return { x: n.position.x + NODE_W, y: n.position.y + dy };
  }

  inPort(n: WorkflowNode) {
    return { x: n.position.x, y: n.position.y + NODE_H / 2 };
  }

  curve(x1: number, y1: number, x2: number, y2: number) {
    const c = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
  }

  edgePath(e: WorkflowEdge) {
    const s = this.nodes().find((n) => n.id === e.source);
    const t = this.nodes().find((n) => n.id === e.target);
    if (!s || !t) return '';
    const a = this.outPort(s, e.sourceHandle);
    const b = this.inPort(t);
    return this.curve(a.x, a.y, b.x, b.y);
  }

  edgeLabel(e: WorkflowEdge) {
    const s = this.nodes().find((n) => n.id === e.source);
    if (!s || !e.sourceHandle) return null;
    const p = this.outPort(s, e.sourceHandle);
    return { x: p.x + 14, y: p.y - 6, text: e.sourceHandle === 'true' ? 'sí' : 'no' };
  }

  nodeSubtitle(n: WorkflowNode): string {
    switch (n.type) {
      case 'connector': {
        for (const c of this.connectors()) {
          const op = c.operations?.find((o) => o.id === n.config['operationId']);
          if (op) return `${c.name} › ${op.name}`;
        }
        return 'Seleccione una operación';
      }
      case 'agent':
        return this.agents().find((a) => a.id === n.config['agentId'])?.name ?? 'Seleccione un agente';
      case 'condition':
        return `${(n.config['rules'] ?? []).length} regla(s) · ${n.config['combinator'] === 'or' ? 'alguna' : 'todas'}`;
      case 'delay':
        return `${n.config['ms']} ms`;
      case 'trigger':
        return this.schedule ? `Cron ${this.schedule}` : 'Manual / webhook / MCP';
      case 'subworkflow':
        return this.workflowName(n.config['workflowId']) ?? 'Seleccione un flujo';
      case 'loop': {
        const target = this.workflowName(n.config['workflowId']);
        return target ? `Por elemento › ${target}` : 'Seleccione un sub-flujo';
      }
      default:
        return nodeMeta(n.type).description;
    }
  }

  // ---------- Datos de entrada del disparador ----------
  inputFields(): InputField[] {
    const raw = this.selectedNode()?.config['inputFields'];
    return Array.isArray(raw) ? raw : [];
  }

  /** Guarda la lista en el disparador; sin campos se quita la clave para no alterar flujos antiguos. */
  private setInputFields(fields: InputField[]) {
    const node = this.selectedNode();
    if (!node) return;
    const config: Record<string, unknown> = { ...node.config, inputFields: fields };
    if (!fields.length) delete config['inputFields'];
    this.updateNode({ config });
  }

  addInputField(name = '') {
    const fields = this.inputFields();
    if (fields.length >= MAX_INPUT_FIELDS) return;
    this.setInputFields([...fields, { name, type: 'string', required: true }]);
  }

  /** Declara de una vez los campos que usan las plantillas (requeridos, tipo libre) para que la API los exija. */
  declareReferenced() {
    const fields = this.inputFields();
    const known = new Set(fields.map((f) => f.name));
    const extra = this.undeclaredRefs().filter((n) => !known.has(n)).map((name) => ({ name, required: true }));
    this.setInputFields([...fields, ...extra].slice(0, MAX_INPUT_FIELDS));
  }

  updateInputField(index: number, patch: Partial<InputField>) {
    const fields = this.inputFields().map((f, i) => {
      if (i !== index) return f;
      const next = { ...f, ...patch };
      if (!next.type) delete next.type;
      if (!next.description) delete next.description;
      return next;
    });
    this.setInputFields(fields);
  }

  removeInputField(index: number) {
    this.setInputFields(this.inputFields().filter((_, i) => i !== index));
  }

  /** Abre la pestaña de ejecución; con la entrada vacía precarga el ejemplo con los campos detectados. */
  openRun() {
    const cur = this.runInput();
    if (!cur || (typeof cur === 'object' && !Object.keys(cur).length)) this.fillSample();
    this.panel.set('run');
  }

  /** Completa el JSON de prueba con los campos detectados que falten (sin pisar valores escritos). */
  fillSample() {
    this.runInput.set(sampleInput(this.hints(), this.runInput()));
  }

  // ---------- Reglas de condición ----------
  updateRule(index: number, patch: Record<string, unknown>) {
    const rules = [...(this.selectedNode()?.config['rules'] ?? [])];
    rules[index] = { ...rules[index], ...patch };
    this.updateConfig({ rules });
  }

  addRule() {
    this.updateConfig({ rules: [...(this.selectedNode()?.config['rules'] ?? []), { left: '', operator: 'eq', right: '' }] });
  }

  removeRule(index: number) {
    this.updateConfig({ rules: (this.selectedNode()?.config['rules'] ?? []).filter((_: unknown, i: number) => i !== index) });
  }

  ref(path: string) {
    return `{{ ${path} }}`;
  }

  copyRef(ref: string) {
    void navigator.clipboard?.writeText(ref);
    this.toast.info(`Copiado: ${ref}`);
  }

  workflowName(id: unknown): string | null {
    if (!id) return null;
    return this.allWorkflows().find((w) => w.id === id)?.name ?? 'Flujo no disponible';
  }

  setConcurrency(v: unknown) {
    const n = Math.round(Number(v));
    this.updateConfig({ concurrency: Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1 });
  }

  // ---------- Persistencia y ejecución ----------
  async save(): Promise<boolean> {
    const invalid = this.graphError();
    if (invalid) {
      this.toast.error(`No se puede guardar: ${invalid}`);
      return false;
    }
    this.saving.set(true);
    try {
      const wf = await this.api.updateWorkflow(this.id(), {
        name: this.name,
        description: this.description || undefined,
        schedule: this.schedule.trim() || null,
        errorWorkflowId: this.errorWorkflowId || null,
        definition: { nodes: this.nodes(), edges: this.edges() },
      });
      this.workflow.set(wf);
      this.dirty.set(false);
      this.toast.success(`Flujo guardado (v${wf.version})`);
      return true;
    } catch (e) {
      this.toast.error(errorMessage(e));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async toggleActive() {
    const wf = this.workflow()!;
    if (this.dirty() && !(await this.save())) return;
    try {
      this.workflow.set(await this.api.setWorkflowActive(wf.id, !wf.active));
      this.toast.success(wf.active ? 'Flujo desactivado' : 'Flujo activado');
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async run() {
    if (this.dirty() && !(await this.save())) return;
    try {
      const ex = await this.api.runWorkflow(this.id(), this.runInput());
      this.execution.set(ex);
      this.panel.set('run');
      clearInterval(this.poll);
      this.poll = setInterval(async () => {
        const cur = await this.api.execution(ex.id);
        this.execution.set(cur);
        if (TERMINAL.includes(cur.status)) clearInterval(this.poll);
      }, 800);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async regenerateWebhook() {
    if (!confirm('El webhook actual dejará de funcionar. ¿Continuar?')) return;
    const { webhookToken } = await this.api.regenerateWebhook(this.id());
    this.workflow.update((w) => (w ? { ...w, webhookToken } : w));
  }

  async remove() {
    if (!confirm('¿Eliminar este flujo y su historial?')) return;
    await this.api.deleteWorkflow(this.id());
    await this.router.navigate(['/workflows']);
  }

  // ---------- Historial de versiones ----------
  openVersions() {
    this.panel.set('versions');
    void this.loadVersions();
  }

  async loadVersions() {
    this.versionsLoading.set(true);
    try {
      const list = await this.wfApi.versions(this.id());
      const current = this.workflow()?.version;
      // La versión vigente se muestra aparte; solo se listan las anteriores.
      this.versions.set(list.filter((v) => !v.current && v.version !== current).sort((a, b) => b.version - a.version));
    } catch (e) {
      this.versions.set([]);
      this.toast.error(errorMessage(e));
    } finally {
      this.versionsLoading.set(false);
    }
  }

  async togglePreview(version: number) {
    if (this.previewVersion() === version) {
      this.previewVersion.set(null);
      return;
    }
    this.previewVersion.set(version);
    const entry = this.versions()?.find((v) => v.version === version);
    if (!entry || entry.definition) return;
    try {
      const full = await this.wfApi.version(this.id(), version);
      if (full.definition) this.versions.update((list) => (list ?? []).map((v) => (v.version === version ? { ...v, definition: full.definition } : v)));
    } catch {
      // Sin detalle disponible: la vista previa muestra solo los metadatos.
    }
  }

  async restore(v: WorkflowVersionInfo) {
    const lost = this.dirty() ? ' Se perderán los cambios sin guardar.' : '';
    if (!confirm(`¿Restaurar la versión v${v.version}? Se creará una versión nueva con esa definición.${lost}`)) return;
    this.restoring.set(v.version);
    try {
      const wf = await this.wfApi.restoreVersion(this.id(), v.version);
      this.apply(wf);
      this.select(null);
      this.panel.set('versions');
      this.execution.set(null);
      this.previewVersion.set(null);
      setTimeout(() => this.fitView());
      this.toast.success(`Versión v${v.version} restaurada (ahora v${wf.version})`);
      await this.loadVersions();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.restoring.set(null);
    }
  }

  // ---------- Probar un nodo (datos fijados) ----------
  /** Nodos previos (excepto el disparador) cuyas salidas pueden fijarse. */
  readonly pinnable = computed(() => this.upstream().filter((n) => n.type !== 'trigger'));

  openTest() {
    const entries: Record<string, PinnedEntry> = {};
    for (const u of this.pinnable()) {
      const out = this.stepOf(u.id)?.output;
      entries[u.id] = out !== undefined ? { on: true, value: structuredClone(out) } : { on: false, value: {} };
    }
    this.pinned.set(entries);
    const ex = this.execution();
    this.testInput = ex?.input !== undefined && ex?.input !== null ? structuredClone(ex.input) : structuredClone(this.runInput() ?? {});
    this.testResult.set(null);
    this.testError.set(null);
    this.testOpen.set(true);
  }

  closeTest() {
    this.testOpen.set(false);
    this.testResult.set(null);
    this.testError.set(null);
  }

  pinOf(nodeId: string): PinnedEntry | undefined {
    return this.pinned()[nodeId];
  }

  setPinned(nodeId: string, patch: Partial<PinnedEntry>) {
    this.pinned.update((p) => ({ ...p, [nodeId]: { ...(p[nodeId] ?? { on: false, value: {} }), ...patch } }));
  }

  async testNode() {
    const node = this.selectedNode();
    if (!node) return;
    if (this.dirty() && !(await this.save())) return;
    const pinned: Record<string, unknown> = {};
    for (const [id, entry] of Object.entries(this.pinned())) if (entry.on) pinned[id] = entry.value;
    this.testing.set(true);
    this.testError.set(null);
    this.testResult.set(null);
    try {
      this.testResult.set(await this.wfApi.testNode(this.id(), node.id, { input: this.testInput, pinned }));
    } catch (e) {
      this.testError.set(errorMessage(e));
    } finally {
      this.testing.set(false);
    }
  }

  webhookUrl() {
    return `${location.origin}/api/hooks/${this.workflow()?.webhookToken}`;
  }

  stepOf(id: string) {
    return this.stepByNode().get(id);
  }

  json(v: unknown) {
    return JSON.stringify(v, null, 2);
  }
}
