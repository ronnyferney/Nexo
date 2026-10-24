import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { errorMessage } from '../../core/api.service';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type {
  AuthorizedAccount,
  DevicePollResult,
  DeviceStartResult,
  ProviderMechanism,
  ProviderView,
} from '../../core/llm-providers.models';
import { IconComponent } from '../../shared/icon.component';
import { isHttpUrl } from '../../shared/safe-url';

type State = 'idle' | 'starting' | 'waiting' | 'confirm' | 'confirming' | 'expired' | 'denied' | 'cancelled' | 'error';

/**
 * Inicio de sesión con código de dispositivo (RFC 8628, p. ej. Hugging Face): muestra el código grande y copiable,
 * el enlace de verificación y una cuenta regresiva, y sondea `device/poll` cada `interval` segundos.
 *
 * M1b: cuando el proveedor autoriza, la conexión no se activa sola. Se muestra la cuenta que autorizó el código (o que
 * el proveedor no la informa) y el ADMIN confirma con `device/confirm` o la rechaza con `device/cancel`: el código pudo
 * escribirlo otra persona en su propia cuenta.
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
      } @else if (st === 'confirm' || st === 'confirming') {
        <section class="confirm" aria-labelledby="dc-confirm-title">
          <h3 id="dc-confirm-title">Confirme la cuenta autorizada</h3>
          @if (account(); as acc) {
            @if (acc.available) {
              <p class="small muted">{{ brand() }} informa que el código se autorizó con esta cuenta:</p>
              <dl class="account">
                @if (acc.name) { <dt>Nombre</dt><dd>{{ acc.name }}</dd> }
                @if (acc.email) { <dt>Correo</dt><dd>{{ acc.email }}</dd> }
                @if (acc.username) { <dt>Usuario</dt><dd>{{ acc.username }}</dd> }
                @if (acc.subject && !acc.email && !acc.username) { <dt>Identificador</dt><dd class="mono">{{ acc.subject }}</dd> }
              </dl>
            } @else {
              <div class="callout warning" role="note"><nx-icon name="alert" [size]="16" />
                <span>{{ brand() }} no informa qué cuenta autorizó el código. Confirme solo si usted mismo lo ingresó en {{ brand() }} hace un momento.</span></div>
            }
          }
          <p class="small muted">Si no reconoce la cuenta, elija «No es mi cuenta»: Nexo descarta la autorización sin crear la conexión.</p>
          <div class="actions">
            <button type="button" class="btn primary pill" [disabled]="st === 'confirming'" (click)="confirm()">
              @if (st === 'confirming') { <span class="spin" aria-hidden="true"></span>Activando… } @else { <nx-icon name="checkCircle" [size]="16" />Sí, activar la conexión }
            </button>
            <button type="button" class="btn pill" [disabled]="st === 'confirming'" (click)="cancel()"><nx-icon name="x" [size]="16" />No es mi cuenta</button>
          </div>
          <span class="timer small" role="timer" aria-live="off">Confirme en {{ remainingLabel() }}</span>
        </section>
      } @else {
        <div class="callout" [class.warning]="st === 'expired' || st === 'cancelled'" [class.danger]="st !== 'expired' && st !== 'cancelled'" role="alert">
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
    .confirm { display: grid; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); }
    .confirm h3 { margin: 0; font-size: 15px; }
    .account { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
    .account dt { color: var(--muted); font-size: 13px; }
    .account dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
    .account .mono { font-family: var(--mono); font-weight: 500; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
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
  /** «Volver a iniciar sesión»: conexión cuyos tokens se renuevan en lugar de crear otra. */
  readonly connectionId = input<string | null>(null);
  readonly connected = output<DevicePollResult>();

  readonly state = signal<State>('idle');
  readonly flow = signal<DeviceStartResult | null>(null);
  readonly problem = signal('');
  readonly announce = signal('');
  readonly copied = signal(false);
  readonly slow = signal(false);
  /** Cuenta que autorizó el código (estado `confirm`, M1b). */
  readonly account = signal<AuthorizedAccount | null>(null);
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
    this.account.set(null);
    this.slow.set(false);
    this.copied.set(false);
    this.failures = 0;
    this.announce.set('Generando código…');
    try {
      const id = this.connectionId();
      const f = await this.api.deviceStart(this.provider().id, id ? { connectionId: id } : {});
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
        if (r === 0 && this.state() !== 'confirming') this.finish('expired');
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
        case 'confirm':
          this.awaitConfirmation(r);
          return;
        case 'connected':
          this.done(r);
          return;
        case 'expired':
        case 'denied':
        case 'cancelled':
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

  /** El proveedor autorizó: se detiene el sondeo y se pide confirmar la cuenta antes de activar (M1b). */
  private awaitConfirmation(r: DevicePollResult) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.account.set(r.account ?? { available: false, source: null });
    this.expiresAt = Date.now() + Math.max(10, r.confirmExpiresIn ?? 600) * 1000;
    this.now.set(Date.now());
    this.state.set('confirm');
    const acc = this.account()!;
    const who = acc.available ? acc.email || acc.username || acc.name || acc.subject : null;
    this.announce.set(
      who
        ? `${this.brand()} autorizó el código con la cuenta ${who}. Confirme si es la suya.`
        : `${this.brand()} autorizó el código pero no informa la cuenta. Confirme solo si usted lo ingresó.`,
    );
  }

  async confirm() {
    const f = this.flow();
    if (!f || this.state() !== 'confirm') return;
    const run = this.run;
    this.state.set('confirming');
    this.announce.set('Activando la conexión…');
    try {
      const r = await this.api.deviceConfirm(this.provider().id, f.flowId);
      if (run !== this.run) return;
      if (r.status === 'connected') this.done(r);
      else this.finish(r.status === 'expired' ? 'expired' : 'denied', r.message);
    } catch (e) {
      if (run !== this.run) return;
      this.fail(errorMessage(e));
    }
  }

  async cancel() {
    const f = this.flow();
    if (!f || this.state() !== 'confirm') return;
    const run = this.run;
    this.state.set('confirming');
    try {
      await this.api.deviceCancel(this.provider().id, f.flowId);
      if (run !== this.run) return;
      this.finish('cancelled');
    } catch (e) {
      if (run !== this.run) return;
      this.fail(errorMessage(e));
    }
  }

  private done(r: DevicePollResult) {
    this.stop();
    this.announce.set(`Sesión iniciada en ${this.brand()}.`);
    this.connected.emit(r);
  }

  private finish(status: 'expired' | 'denied' | 'cancelled', message?: string) {
    this.stop();
    this.state.set(status);
    const text =
      status === 'expired'
        ? 'El código o el plazo para confirmar la cuenta venció. Genere otro para intentarlo de nuevo.'
        : status === 'cancelled'
          ? `Se descartó la autorización: no se creó ninguna conexión. Genere otro código e ingréselo con su cuenta de ${this.brand()}.`
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
