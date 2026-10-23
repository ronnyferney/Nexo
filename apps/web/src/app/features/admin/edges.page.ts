import { ChangeDetectionStrategy, Component, computed, DestroyRef, DOCUMENT, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { errorMessage } from '../../core/api.service';
import { IntegrationsApi } from '../../core/integrations.api';
import type { EdgeAgent } from '../../core/integrations.models';
import { ToastService } from '../../core/toast.service';
import { IconComponent } from '../../shared/icon.component';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';

const REFRESH_MS = 30_000;

export const EDGE_YAML_EXAMPLE = `# edge.yaml — conexiones locales de Nexo Edge. Las credenciales nunca salen de su red.
connections:
  astrans:
    engine: mssql
    host: 10.0.0.15
    port: 1433
    database: ASTRANS
    user: nexo_lectura
    password: \${ASTRANS_DB_PASSWORD}   # se lee de una variable de entorno
    allowWrites: false
    maxRows: 1000
    # tables: [dbo.Vehiculos, dbo.Viajes]   # opcional: solo estas tablas
`;

/** Administración → Nexo Edge: agentes on-premise para bases de datos en redes privadas (ADR 0005 D5). */
@Component({
  selector: 'nx-edges',
  imports: [FormsModule, IconComponent, RelativeTimePipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page-header">
        <div><h1>Nexo Edge</h1><p>Conecte bases de datos de su red privada u on-premise sin exponerlas a internet.</p></div>
        <div class="row wrap">
          <button class="btn" [disabled]="loading()" (click)="load()" title="Actualizar estado" aria-label="Actualizar estado"><nx-icon name="refresh" /></button>
          <button class="btn primary" [attr.aria-expanded]="registering()" aria-controls="edge-register" (click)="registering.set(!registering())"><nx-icon name="plus" />Registrar Edge</button>
        </div>
      </div>

      <section class="card how" aria-labelledby="how-title">
        <h2 id="how-title" class="sr-only">Cómo funciona</h2>
        <div class="diagram" aria-hidden="true">
          <div class="zone"><span class="small muted">Su red</span>
            <div class="node"><nx-icon name="database" />Base de datos</div>
            <span class="link-local">↔</span>
            <div class="node edge"><nx-icon name="server" />Nexo Edge<small class="mono">edge.yaml</small></div></div>
          <div class="wire"><span class="small">WSS saliente · 443</span><span class="arrow">→</span></div>
          <div class="zone cloud"><span class="small muted">Nube</span><div class="node"><nx-icon name="globe" />Nexo</div></div>
        </div>
        <ul class="points">
          <li><nx-icon name="send" [size]="16" /><span><strong>Conexión saliente.</strong> El Edge se conecta hacia Nexo por WebSocket seguro y se reconecta solo.</span></li>
          <li><nx-icon name="lock" [size]="16" /><span><strong>Credenciales locales.</strong> Usuario y contraseña viven en su <code>edge.yaml</code>; Nexo solo conoce el nombre de la conexión.</span></li>
          <li><nx-icon name="shield" [size]="16" /><span><strong>Sin puertos abiertos.</strong> No requiere reglas de firewall entrantes. El Edge vuelve a validar lectura, límites y escrituras.</span></li>
        </ul>
      </section>

      @if (registering()) {
        <form id="edge-register" class="card stack editor" (ngSubmit)="create()">
          <h2>Registrar Edge</h2>
          <div class="field"><label for="edge-name">Nombre</label>
            <input id="edge-name" name="name" class="input" required minlength="2" placeholder="Ej. Bodega Bogotá — servidor ASTRANS" [(ngModel)]="newName" />
            <span class="hint">Identifique el sitio o servidor donde se ejecutará.</span></div>
          <div class="row"><span class="spacer"></span>
            <button type="button" class="btn" (click)="registering.set(false)">Cancelar</button>
            <button type="submit" class="btn primary" [disabled]="busy() || newName.trim().length < 2">{{ busy() === 'create' ? 'Registrando…' : 'Registrar' }}</button></div>
        </form>
      }

      @if (reveal(); as rv) {
        <section class="card stack editor" aria-labelledby="token-title" tabindex="-1" id="edge-token">
          <div class="row wrap"><h2 id="token-title" class="grow">Instale «{{ rv.name }}»</h2>
            <button class="btn ghost icon" aria-label="Cerrar instrucciones" title="Cerrar" (click)="reveal.set(null)"><nx-icon name="x" /></button></div>
          <div class="callout warning" role="alert"><nx-icon name="alert" [size]="16" />
            <span>Copie el token ahora: <strong>no se volverá a mostrar</strong>. Si lo pierde, rote el token.</span></div>
          <div class="field"><label for="edge-tk">Token</label>
            <div class="copy-box"><pre id="edge-tk" class="code-block mono">{{ rv.token }}</pre>
              <button class="btn icon sm" title="Copiar token" aria-label="Copiar token" (click)="copy(rv.token, 'Token')"><nx-icon name="copy" [size]="15" /></button></div></div>
          <div class="field"><label for="edge-cmd">1. Ejecute el contenedor en un servidor con acceso a la base</label>
            <div class="copy-box"><pre id="edge-cmd" class="code-block mono">{{ command(rv.token) }}</pre>
              <button class="btn icon sm" title="Copiar comando" aria-label="Copiar comando" (click)="copy(command(rv.token), 'Comando')"><nx-icon name="copy" [size]="15" /></button></div>
            <span class="hint">Defina también las variables que use el archivo, p. ej. <code>-e ASTRANS_DB_PASSWORD=…</code> o un archivo <code>--env-file</code>.</span></div>
          <div class="field"><label for="edge-yaml">2. Cree <code>edge.yaml</code> junto al comando</label>
            <div class="copy-box"><pre id="edge-yaml" class="code-block mono yaml">{{ yaml }}</pre>
              <button class="btn icon sm" title="Copiar edge.yaml" aria-label="Copiar edge.yaml" (click)="copy(yaml, 'edge.yaml')"><nx-icon name="copy" [size]="15" /></button></div>
            <span class="hint">Luego, en un conector «Base de datos», elija el modo «A través de Nexo Edge», este Edge y la conexión <code>astrans</code>.</span></div>
          <div class="row"><span class="spacer"></span><button class="btn primary" (click)="reveal.set(null)">Listo, ya lo copié</button></div>
        </section>
      }

      @if (loading() && !edges().length) {
        <p class="muted" role="status">Cargando Edge…</p>
      } @else if (error()) {
        <div class="card empty" role="alert"><nx-icon name="alert" [size]="32" /><h3>No se pudieron cargar los Edge</h3><p>{{ error() }}</p>
          <button class="btn" (click)="load()"><nx-icon name="refresh" />Reintentar</button></div>
      } @else if (!edges().length) {
        <div class="card empty"><nx-icon name="server" [size]="36" /><h3>Sin Edge registrados</h3>
          <p>Registre un Edge para conectar bases de datos que están en su red privada.</p></div>
      } @else {
        <div class="card flush">
          <div class="table-wrap">
            <table class="table">
              <caption class="sr-only">Edge registrados ({{ online() }} en línea de {{ edges().length }})</caption>
              <thead><tr><th scope="col">Nombre</th><th scope="col">Estado</th><th scope="col">Versión</th><th scope="col">Host</th><th scope="col">Conexiones</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
              <tbody>
                @for (e of edges(); track e.id) {
                  <tr>
                    <td><strong>{{ e.name }}</strong></td>
                    <td class="nowrap"><span class="presence" [class.online]="e.status === 'ONLINE'" [class.offline]="e.status !== 'ONLINE'">{{ e.status === 'ONLINE' ? 'En línea' : 'Fuera de línea' }}</span>
                      <span class="muted small block" [title]="e.lastSeenAt ? (e.lastSeenAt | date: 'medium') : ''">{{ e.lastSeenAt ? 'Visto ' + (e.lastSeenAt | ago) : 'Nunca conectado' }}</span></td>
                    <td class="mono small">{{ e.version || '—' }}</td>
                    <td class="mono small">{{ e.hostname || '—' }}</td>
                    <td>@if (e.connections.length) { <span class="chips">@for (k of e.connections; track k) { <code class="badge">{{ k }}</code> }</span> } @else { <span class="muted small">—</span> }</td>
                    <td class="nowrap actions">
                      <button class="btn sm" [disabled]="busy()" (click)="rotate(e)" [attr.aria-label]="'Rotar token de ' + e.name"><nx-icon name="key" [size]="14" />Rotar token</button>
                      <button class="btn sm icon danger" [disabled]="busy()" (click)="remove(e)" [title]="'Eliminar ' + e.name" [attr.aria-label]="'Eliminar ' + e.name"><nx-icon name="trash" [size]="14" /></button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .how { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 20px; align-items: center; margin-bottom: 20px; }
    .diagram { display: flex; align-items: center; gap: 10px; }
    .zone { display: flex; align-items: center; gap: 8px; padding: 22px 10px 10px; border: 1px dashed var(--border); border-radius: 12px; position: relative; flex-wrap: wrap; }
    .zone > span:first-child { position: absolute; top: 4px; left: 10px; }
    .zone.cloud { border-style: solid; background: var(--primary-50); }
    .node { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 10px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); font-size: 12.5px; font-weight: 600; text-align: center; }
    .node.edge { border-color: var(--primary); color: var(--primary); }
    .node small { font-weight: 400; color: var(--muted); }
    .wire { display: flex; flex-direction: column; align-items: center; color: var(--success); font-weight: 600; flex: 1; min-width: 70px; text-align: center; }
    .arrow { font-size: 22px; line-height: 1; }
    .link-local { color: var(--muted); }
    .points { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 13px; }
    .points li { display: flex; gap: 10px; align-items: flex-start; }
    .points nx-icon { color: var(--primary); margin-top: 2px; }
    .flush { padding: 0; }
    .actions { text-align: right; }
    .actions .btn + .btn { margin-left: 6px; }
    .grow { flex: 1; min-width: 0; }
    .copy-box pre { white-space: pre-wrap; word-break: break-all; }
    .copy-box pre.yaml { white-space: pre; word-break: normal; overflow-x: auto; }
    @media (max-width: 900px) { .how { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .diagram { flex-direction: column; align-items: stretch; } .wire .arrow { transform: rotate(90deg); } .zone { justify-content: center; } }
  `,
})
export class EdgesPage implements OnInit {
  private readonly api = inject(IntegrationsApi);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  readonly edges = signal<EdgeAgent[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<string | null>(null);
  readonly registering = signal(false);
  readonly reveal = signal<{ name: string; token: string } | null>(null);
  readonly online = computed(() => this.edges().filter((e) => e.status === 'ONLINE').length);
  readonly yaml = EDGE_YAML_EXAMPLE;
  newName = '';

  constructor() {
    const timer = setInterval(() => void this.load(true), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  async ngOnInit() {
    await this.load();
  }

  /** `silent`: refresco periódico, sin reemplazar la vista por un error transitorio. */
  async load(silent = false) {
    if (!silent) {
      this.loading.set(true);
      this.error.set(null);
    }
    try {
      this.edges.set(await this.api.adminEdges());
      this.error.set(null);
    } catch (e) {
      if (!silent) this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  command(token: string) {
    const origin = this.document.location.origin;
    return `docker run -d --name nexo-edge -e NEXO_URL=${origin} -e NEXO_EDGE_TOKEN=${token} -v $(pwd)/edge.yaml:/app/edge.yaml nexo/edge`;
  }

  async create() {
    const name = this.newName.trim();
    if (name.length < 2) return;
    this.busy.set('create');
    try {
      const created = await this.api.createEdge(name);
      this.newName = '';
      this.registering.set(false);
      this.showToken(created.name, created.token);
      this.toast.success('Edge registrado');
      await this.load(true);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async rotate(e: EdgeAgent) {
    if (!confirm(`¿Rotar el token de «${e.name}»? El Edge en ejecución se desconectará hasta que configure el token nuevo.`)) return;
    this.busy.set(e.id);
    try {
      const { token } = await this.api.rotateEdgeToken(e.id);
      this.showToken(e.name, token);
      this.toast.success('Token rotado');
      await this.load(true);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  async remove(e: EdgeAgent) {
    if (!confirm(`¿Eliminar «${e.name}»? Los conectores que lo usan dejarán de funcionar.`)) return;
    this.busy.set(e.id);
    try {
      await this.api.deleteEdge(e.id);
      this.toast.success('Edge eliminado');
      await this.load(true);
    } catch (err) {
      this.toast.error(errorMessage(err));
    } finally {
      this.busy.set(null);
    }
  }

  async copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success(`${label} copiado`);
    } catch {
      this.toast.error('No se pudo copiar. Selecciónelo y cópielo manualmente.');
    }
  }

  private showToken(name: string, token: string) {
    this.reveal.set({ name, token });
    setTimeout(() => this.document.getElementById('edge-token')?.focus());
  }
}
