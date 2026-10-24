import { DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import type { OAuthReturnMessage, ProviderView } from '../../core/llm-providers.models';
import { isHttpUrl } from '../../shared/safe-url';

/** Resultado del inicio de sesión: retorno del proveedor o ventana cerrada sin respuesta. */
export type OAuthOutcome =
  | { status: 'connected' | 'error'; providerId: string | null; connectionId: string | null; reason: string | null }
  | { status: 'closed'; providerId: string; connectionId: null; reason: null };

const POPUP_NAME = 'nexo-llm-oauth';
const CHANNEL = 'nexo-llm-oauth';
const TYPE = 'nexo:llm-oauth';

/**
 * Coordina el OAuth de proveedores de IA en una ventana emergente centrada.
 *
 * - La ventana se abre en el mismo gesto del clic (antes de pedir `authorizeUrl`) para que el navegador no la bloquee;
 *   si aun así la bloquea, la pestaña se redirige al proveedor y el retorno llega por la URL.
 * - Al volver a `/admin/providers?llm=…`, la ventana emergente avisa a la principal con `postMessage` al mismo origen
 *   y, como respaldo (algunos proveedores cortan `window.opener` con COOP), con `BroadcastChannel`; luego se cierra.
 * - Si el usuario cierra la ventana sin terminar, se emite `closed` y la página recarga por si la conexión sí quedó.
 */
@Injectable()
export class LlmOAuthFlow {
  private readonly api = inject(LlmProvidersApi);
  private readonly document = inject(DOCUMENT);
  private readonly win = this.document.defaultView!;

  /** Proveedor con inicio de sesión en curso (la fila muestra «Conectando…/Cancelar»). */
  readonly pending = signal<{ providerId: string; name: string } | null>(null);

  private popup: Window | null = null;
  private watch: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private readonly listeners = new Set<(o: OAuthOutcome) => void>();
  /** Llega por `postMessage` y por `BroadcastChannel`: se procesa una sola vez. */
  private lastKey = '';

  constructor() {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== this.win.location.origin) return;
      this.receive(ev.data);
    };
    this.win.addEventListener('message', onMessage);
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (ev) => this.receive(ev.data);
    }
    inject(DestroyRef).onDestroy(() => {
      this.win.removeEventListener('message', onMessage);
      this.channel?.close();
      this.stopWatch();
    });
  }

  onOutcome(fn: (o: OAuthOutcome) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Inicia sesión con el proveedor. Debe llamarse directamente desde el manejador del clic.
   * Lanza el error de la API (p. ej. app OAuth no configurada) para que la vista lo muestre.
   */
  async start(p: ProviderView, fields?: Record<string, string>) {
    this.cancel();
    this.popup = this.openPopup(p.name);
    this.pending.set({ providerId: p.id, name: p.name });
    try {
      const { authorizeUrl } = await this.api.oauthStart(p.id, fields && Object.keys(fields).length ? { fields } : {});
      if (!isHttpUrl(authorizeUrl)) throw new Error('El proveedor devolvió una dirección de autorización no válida.');
      if (this.pending()?.providerId !== p.id) return; // cancelado mientras se pedía la URL
      if (this.popup && !this.popup.closed) {
        this.popup.location.href = authorizeUrl;
        this.popup.focus();
        this.startWatch(p.id);
      } else {
        this.win.location.assign(authorizeUrl); // ventana bloqueada: se continúa en esta pestaña
      }
    } catch (e) {
      this.cancel();
      throw e;
    }
  }

  cancel() {
    this.stopWatch();
    if (this.popup && !this.popup.closed) this.popup.close();
    this.popup = null;
    this.pending.set(null);
  }

  /**
   * En la ventana emergente que volvió del proveedor: avisa a la principal y se cierra.
   * Devuelve `true` si esta pestaña es la emergente (la página no debe cargar la galería).
   */
  notifyOpener(msg: Omit<OAuthReturnMessage, 'type'>): boolean {
    const data: OAuthReturnMessage = { type: TYPE, ...msg };
    this.channel?.postMessage(data);
    let opener: Window | null = null;
    try {
      opener = this.win.opener && this.win.opener !== this.win ? (this.win.opener as Window) : null;
    } catch {
      opener = null;
    }
    const isPopup = !!opener || this.win.name === POPUP_NAME;
    if (opener) {
      try {
        opener.postMessage(data, this.win.location.origin);
      } catch {
        /* la principal ya no existe o cambió de origen: queda el BroadcastChannel */
      }
    }
    if (isPopup) setTimeout(() => this.win.close(), 150);
    return isPopup;
  }

  private receive(data: unknown) {
    const m = data as Partial<OAuthReturnMessage> | null;
    if (!m || m.type !== TYPE || (m.llm !== 'connected' && m.llm !== 'error')) return;
    const str = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : null);
    const key = `${m.llm}|${str(m.provider)}|${str(m.connectionId)}|${str(m.reason)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    setTimeout(() => this.lastKey === key && (this.lastKey = ''), 3000);
    this.stopWatch();
    this.popup = null;
    this.pending.set(null);
    this.emit({ status: m.llm, providerId: str(m.provider), connectionId: str(m.connectionId), reason: str(m.reason) });
  }

  private emit(o: OAuthOutcome) {
    for (const fn of this.listeners) fn(o);
  }

  private openPopup(name: string): Window | null {
    const w = 520;
    const h = 680;
    const sx = this.win.screenX ?? 0;
    const sy = this.win.screenY ?? 0;
    const left = Math.max(0, Math.round(sx + (this.win.outerWidth - w) / 2));
    const top = Math.max(0, Math.round(sy + (this.win.outerHeight - h) / 2));
    let popup: Window | null = null;
    try {
      popup = this.win.open('', POPUP_NAME, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    } catch {
      popup = null;
    }
    if (!popup) return null;
    try {
      // Página de espera mientras llega `authorizeUrl` (texto plano, sin HTML interpolado).
      const d = popup.document;
      d.title = `Conectando con ${name}…`;
      d.body.style.cssText = 'font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#6b7189';
      d.body.textContent = `Abriendo el inicio de sesión de ${name}…`;
    } catch {
      /* ventana reutilizada en otro origen */
    }
    return popup;
  }

  private startWatch(providerId: string) {
    this.stopWatch();
    this.watch = setInterval(() => {
      if (!this.popup || !this.popup.closed) return;
      this.stopWatch();
      // Margen para que llegue el mensaje si la ventana se cerró sola tras el retorno.
      setTimeout(() => {
        if (this.pending()?.providerId !== providerId) return;
        this.popup = null;
        this.pending.set(null);
        this.emit({ status: 'closed', providerId, connectionId: null, reason: null });
      }, 900);
    }, 500);
  }

  private stopWatch() {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
  }
}
