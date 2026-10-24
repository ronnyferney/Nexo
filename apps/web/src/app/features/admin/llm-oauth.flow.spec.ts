import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LlmProvidersApi } from '../../core/llm-providers.api';
import { LlmOAuthFlow, type OAuthOutcome } from './llm-oauth.flow';

const ORIGIN = 'https://nexo.example.com';

/** Ventana simulada: permite fijar el origen, el `opener` y entregar mensajes como si llegaran por `postMessage`. */
class FakeWindow {
  readonly location = { origin: ORIGIN, assign: jasmine.createSpy('assign') };
  opener: unknown = null;
  name = '';
  close = jasmine.createSpy('close');
  private readonly handlers: ((ev: MessageEvent) => void)[] = [];
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    if (type === 'message') this.handlers.push(fn);
  }
  removeEventListener(_type: string, fn: (ev: MessageEvent) => void) {
    this.handlers.splice(this.handlers.indexOf(fn), 1);
  }
  deliver(data: unknown, origin = ORIGIN) {
    for (const fn of [...this.handlers]) fn({ data, origin } as MessageEvent);
  }
  get listenerCount() {
    return this.handlers.length;
  }
}

const valid = { type: 'nexo:llm-oauth', llm: 'connected', provider: 'vertex', connectionId: 'c1', reason: null };

describe('LlmOAuthFlow (retorno por postMessage)', () => {
  let win: FakeWindow;
  let flow: LlmOAuthFlow;
  let outcomes: OAuthOutcome[];

  beforeEach(() => {
    jasmine.clock().install();
    win = new FakeWindow();
    TestBed.configureTestingModule({
      providers: [
        LlmOAuthFlow,
        { provide: DOCUMENT, useValue: { defaultView: win } },
        { provide: LlmProvidersApi, useValue: { oauthStart: jasmine.createSpy('oauthStart') } },
      ],
    });
    flow = TestBed.inject(LlmOAuthFlow);
    outcomes = [];
    flow.onOutcome((o) => outcomes.push(o));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jasmine.clock().uninstall();
  });

  it('acepta un mensaje bien formado del mismo origen', () => {
    win.deliver(valid);
    expect(outcomes).toEqual([{ status: 'connected', providerId: 'vertex', connectionId: 'c1', reason: null }]);
    expect(flow.pending()).toBeNull();
  });

  it('ignora mensajes de otro origen aunque tengan la forma correcta', () => {
    win.deliver(valid, 'https://atacante.example');
    win.deliver(valid, 'http://nexo.example.com'); // mismo host, otro esquema
    win.deliver(valid, 'null');
    expect(outcomes).toEqual([]);
  });

  it('ignora mensajes del mismo origen con forma inválida', () => {
    for (const data of [
      null,
      'nexo:llm-oauth',
      42,
      {},
      { ...valid, type: 'otro' },
      { ...valid, llm: 'closed' },
      { ...valid, llm: undefined },
    ]) {
      win.deliver(data);
    }
    expect(outcomes).toEqual([]);
  });

  it('descarta campos que no son texto o son demasiado largos', () => {
    win.deliver({ type: 'nexo:llm-oauth', llm: 'error', provider: { x: 1 }, connectionId: 7, reason: 'r'.repeat(201) });
    expect(outcomes).toEqual([{ status: 'error', providerId: null, connectionId: null, reason: null }]);
  });

  it('procesa una sola vez el mismo retorno repetido (postMessage + BroadcastChannel)', () => {
    win.deliver(valid);
    win.deliver({ ...valid });
    expect(outcomes.length).toBe(1);
    jasmine.clock().tick(3001);
    win.deliver(valid);
    expect(outcomes.length).toBe(2);
  });

  it('deja de escuchar al destruirse', () => {
    expect(win.listenerCount).toBe(1);
    TestBed.resetTestingModule();
    expect(win.listenerCount).toBe(0);
  });
});

describe('LlmOAuthFlow.notifyOpener', () => {
  let win: FakeWindow;

  beforeEach(() => {
    jasmine.clock().install();
    win = new FakeWindow();
    TestBed.configureTestingModule({
      providers: [
        LlmOAuthFlow,
        { provide: DOCUMENT, useValue: { defaultView: win } },
        { provide: LlmProvidersApi, useValue: {} },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jasmine.clock().uninstall();
  });

  it('avisa a la ventana principal solo hacia el origen propio y se cierra', () => {
    const opener = { postMessage: jasmine.createSpy('postMessage') };
    win.opener = opener;
    const flow = TestBed.inject(LlmOAuthFlow);

    expect(flow.notifyOpener({ llm: 'connected', provider: 'vertex', connectionId: 'c1', reason: null })).toBeTrue();
    expect(opener.postMessage).toHaveBeenCalledOnceWith(
      { type: 'nexo:llm-oauth', llm: 'connected', provider: 'vertex', connectionId: 'c1', reason: null },
      ORIGIN,
    );
    expect(win.close).not.toHaveBeenCalled();
    jasmine.clock().tick(200);
    expect(win.close).toHaveBeenCalled();
  });

  it('en una pestaña normal (sin opener) no se cierra ni publica a otra ventana', () => {
    const flow = TestBed.inject(LlmOAuthFlow);
    expect(flow.notifyOpener({ llm: 'error', provider: 'vertex', connectionId: null, reason: 'access_denied' })).toBeFalse();
    jasmine.clock().tick(200);
    expect(win.close).not.toHaveBeenCalled();
  });

  it('un opener inaccesible no rompe el retorno', () => {
    const opener = {
      postMessage: () => {
        throw new Error('cross-origin');
      },
    };
    win.opener = opener;
    const flow = TestBed.inject(LlmOAuthFlow);
    expect(flow.notifyOpener({ llm: 'connected', provider: 'p', connectionId: 'c', reason: null })).toBeTrue();
  });
});
