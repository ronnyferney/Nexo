import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type { DevicePollResult, DeviceStartResult, ProviderMechanism, ProviderView } from '../../core/llm-providers.models';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';

type State = 'idle' | 'starting' | 'waiting' | 'expired' | 'denied' | 'error';

/**
 * Inicio de sesión con código de dispositivo (RFC 8628, p. ej. Hugging Face): muestra el código grande y copiable,
 * el enlace de verificación y una cuenta regresiva, y sondea `device/poll` cada `interval` segundos.
 */
@Component({
  selector: 'nx-device-code',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let st = state();
    @if (st === 'idle' || st === 'starting') {
      <p class="lead">{{ brand() }} le dará un código para autorizar a Nexo desde su navegador. No necesita copiar claves.</p>
      <button type="button" class="btn primary pill wide" [disabled]="st === 'starting' || !mechanism().available" (click)="start()">
        @if (st === 'starting') { <span class="spin" aria-hidden="true"></span>Generando código… } @else { <nx-icon name="key" [size]="16" />{{ mechanism().label }} }
      </button>
    } @else if (flow(); as f) {
      @if (st === 'waiting') {
        <ol class="dc-steps">
          <li><span>Copie este código de un solo uso</span>
            <div class="code-box">
              <span class="code" [attr.aria-label]="'Código ' + spelled()">{{ f.userCode }}</span>
              <button type="button" class="btn pill" (click)="copy()" [attr.aria-label]="copied() ? 'Código copiado' : 'Copiar código'">
                <nx-icon [name]="copied() ? 'check' : 'copy'" [size]="15" />{{ copied() ? 'Copiado' : 'Copiar' }}</button>
            </div></li>
          <li><span>Péguelo en {{ brand() }} y autorice a Nexo</span>
            @if (verifyUrl(); as u) {
              <a class="btn primary pill wide" [href]="u" target="_blank" rel="noopener noreferrer" (click)="copy()">
                <nx-icon name="externalLink" [size]="15" />Abrir {{ verifyLabel() }}<span class="sr-only"> (abre en otra pestaña)</span></a>
            }</li>
        </ol>
        <div class="wait">
          <span class="spin dark" aria-hidden="true"></span>
          <span>{{ slow() ? brand() + ' pidió verificar con menos frecuencia. Seguimos esperando…' : 'Esperando la autorización…' }}</span>
          <span class="timer" role="timer" aria-live="off">Vence en {{ remainingLabel() }}</span>
        </div>
      } @else {
        <div class="callout" [class.warning]="st === 'expired'" [class.danger]="st !== 'expired'" role="alert">
          <nx-icon name="alert" [size]="16" /><span>{{ problem() }}</span></div>
        <button type="button" class="btn primary pill wide again" (click)="start()"><nx-icon name="refresh" [size]="16" />Generar otro código</button>
      }
    } @else if (st === 'error') {
      <div class="callout danger" role="alert"><nx-icon name="alert" [size]="16" /><span>{{ problem() }}</span></div>
      <button type="button" class="btn primary pill wide again" (click)="start()"><nx-icon name="refresh" [size]="16" />Generar otro código</button>
    }
    <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announce() }}</p>
    @if (st === 'waiting') { <p class="small muted">El código solo sirve para su cuenta de {{ brand() }} y vence en {{ minutes() }} {{ minutes() === 1 ? 'minuto' : 'minutos' }}.</p> }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    .lead { margin: 0; color: var(--muted); line-height: 1.55; }
    .pill { border-radius: 999px; height: 40px; padding: 0 18px; }
    .wide { width: 100%; justify-content: center; }
    .dc-steps { margin: 0; padding-left: 20px; display: grid; gap: 14px; }
    .dc-steps li > span { display: block; font-weight: 600; margin-bottom: 8px; }
    .code-box { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border: 1px dashed var(--border);
      border-radius: 12px; background: var(--surface-2); }
    .code { flex: 1 0 auto; font-family: var(--mono); font-size: clamp(22px, 7vw, 32px); font-weight: 700; letter-spacing: 0.12em;
      user-select: all; white-space: nowrap; }
    .wait { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px; border-radius: 10px; background: var(--info-50); font-size: 13px; }
    .timer { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .again { margin-top: -2px; }
    .spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.4); border-top-color: #fff; animation: spin 0.7s linear infinite; flex-shrink: 0; }
    .spin.dark { border-color: var(--border); border-top-color: var(--info); }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
  `,
})
export class DeviceCodeComponent implements OnInit {
  private readonly api = inject(LlmProvidersApi);

  readonly provider = input.required<ProviderView>();
  readonly mechanism = input.required<ProviderMechanism>();
  /** Genera el código al abrir (el usuario pulsó «+» en la galería). */
  readonly autostart = input(false);
  readonly connected = output<DevicePollResult>();

  readonly state = signal<State>('idle');
  readonly flow = signal<DeviceStartResult | null>(null);
  readonly problem = signal('');
  readonly announce = signal('');
  readonly copied = signal(false);
  readonly slow = signal(false);
  private readonly now = signal(Date.now());
  private expiresAt = 0;
  private interval = 5;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private run = 0;

  /** Nombre del proveedor en los textos («Péguelo en Hugging Face…»). */
  readonly brand = computed(() => this.provider().name);
  readonly verifyUrl = computed(() => {
    const f = this.flow();
    const u = f?.verificationUriComplete || f?.verificationUri;
    return isHttpUrl(u) ? u! : null;
  });
  /** «Abrir huggingface.co»: dominio de `verificationUri` (la URL completa la decide el proveedor). */
  readonly verifyLabel = computed(() => {
    try {
      return new URL(this.flow()!.verificationUri).host.replace(/^www\./, '');
    } catch {
      return this.brand();
    }
  });
  readonly remaining = computed(() => Math.max(0, Math.round((this.expiresAt - this.now()) / 1000)));
  readonly remainingLabel = computed(() => {
    const s = this.remaining();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });
  readonly minutes = computed(() => Math.max(1, Math.round((this.flow()?.expiresIn ?? 900) / 60)));
  /** El lector de pantalla lee el código carácter por carácter. */
  readonly spelled = computed(() => (this.flow()?.userCode ?? '').split('').join(' '));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  ngOnInit() {
    if (this.autostart() && this.mechanism().available) void this.start();
  }

  async start() {
    this.stop();
    const run = ++this.run;
    this.state.set('starting');
    this.flow.set(null);
    this.slow.set(false);
    this.copied.set(false);
    this.failures = 0;
    this.announce.set('Generando código…');
    try {
      const f = await this.api.deviceStart(this.provider().id);
      if (run !== this.run) return;
      this.flow.set(f);
      this.interval = Math.max(1, f.interval || 5);
      this.expiresAt = Date.now() + Math.max(30, f.expiresIn || 900) * 1000;
      this.now.set(Date.now());
      this.state.set('waiting');
      this.announce.set(`Código ${this.spelled()}. Ábralo en ${this.brand()} y autorice a Nexo. Vence en ${this.minutes()} ${this.minutes() === 1 ? 'minuto' : 'minutos'}.`);
      this.tick = setInterval(() => {
        this.now.set(Date.now());
        const r = this.remaining();
        if (r === 60) this.announce.set('Queda un minuto para usar el código.');
        if (r === 0) this.finish('expired');
      }, 1000);
      this.schedule(run);
    } catch (e) {
      if (run !== this.run) return;
      this.fail(errorMessage(e));
    }
  }

  async copy() {
    const code = this.flow()?.userCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
      this.announce.set('Código copiado al portapapeles.');
      setTimeout(() => this.copied.set(false), 2500);
    } catch {
      /* sin permiso de portapapeles: el código queda seleccionable */
    }
  }

  private schedule(run: number) {
    this.timer = setTimeout(() => void this.poll(run), this.interval * 1000);
  }

  private async poll(run: number) {
    const f = this.flow();
    if (!f || run !== this.run || this.state() !== 'waiting') return;
    try {
      const r = await this.api.devicePoll(this.provider().id, f.flowId);
      if (run !== this.run) return;
      this.failures = 0;
      switch (r.status) {
        case 'connected':
          this.stop();
          this.announce.set(`Sesión iniciada en ${this.brand()}.`);
          this.connected.emit(r);
          return;
        case 'expired':
        case 'denied':
          this.finish(r.status, r.message);
          return;
        case 'slow_down':
          this.interval = Math.max(this.interval + 5, r.interval ?? 0);
          if (!this.slow()) this.announce.set(`${this.brand()} pidió verificar con menos frecuencia. Seguimos esperando.`);
          this.slow.set(true);
          break;
        default:
          if (r.interval) this.interval = Math.max(1, r.interval);
      }
      this.schedule(run);
    } catch (e) {
      if (run !== this.run) return;
      // Errores de red puntuales: se reintenta; tras tres seguidos se informa.
      if (++this.failures >= 3) this.fail(errorMessage(e));
      else this.schedule(run);
    }
  }

  private finish(status: 'expired' | 'denied', message?: string) {
    this.stop();
    this.state.set(status);
    const text =
      status === 'expired'
        ? 'El código venció antes de que se autorizara. Genere otro para intentarlo de nuevo.'
        : message || `Se rechazó la autorización en ${this.brand()}. Si fue un error, genere otro código.`;
    this.problem.set(text);
    this.announce.set(text);
  }

  private fail(msg: string) {
    this.stop();
    this.state.set('error');
    this.flow.set(null);
    this.problem.set(msg);
    this.announce.set(msg);
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    if (this.tick) clearInterval(this.tick);
    this.timer = null;
    this.tick = null;
  }
}
