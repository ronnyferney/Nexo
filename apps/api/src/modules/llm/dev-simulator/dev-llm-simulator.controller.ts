import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { DevLlmSimulatorService, SIM_MODELS, SimOAuthError, simulatedCompletion } from './dev-llm-simulator.service';

const str = (v: unknown) => (typeof v === 'string' && v.length <= 4096 ? v : '');
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Página mínima del simulador (consentimiento y código de dispositivo). */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font:15px/1.5 Inter,system-ui,sans-serif;background:#08102D;color:#e8eaf6;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#151829;border:1px solid #2a2f49;border-radius:16px;padding:28px;max-width:440px;width:100%}
h1{font-size:20px;margin:0 0 6px}p{color:#9aa0bd;margin:8px 0}.tag{display:inline-block;background:#24264d;color:#c9ccff;border-radius:999px;padding:2px 10px;font-size:12px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}button{font:inherit;border-radius:999px;padding:9px 18px;border:1px solid #2a2f49;background:#1c2035;color:#e8eaf6;cursor:pointer}
button.primary{background:#125BEA;border-color:#125BEA;color:#fff}input{font:inherit;padding:8px 12px;border-radius:10px;border:1px solid #2a2f49;background:#0d0f1c;color:#fff;letter-spacing:2px;text-transform:uppercase}
code{font-size:22px;letter-spacing:3px}.danger{color:#ff8fa3;border-color:#5a2433}small{color:#9aa0bd}</style></head>
<body><main><span class="tag">Simulador local de Nexo · solo desarrollo</span>${body}</main></body></html>`;
}

/**
 * Proveedor simulado para desarrollo local (`LLM_DEV_SIMULATOR=true`, nunca en producción): endpoints OAuth 2.0
 * (authorize, token, device, revoke) y API compatible con OpenAI. Todas las rutas responden 404 si está apagado.
 */
@ApiExcludeController()
@Public()
@Throttle({ default: { limit: 600, ttl: 60_000 } })
@Controller('dev/llm-sim')
export class DevLlmSimulatorController {
  constructor(private readonly sim: DevLlmSimulatorService) {}

  @Get('authorize')
  authorize(@Query() q: Record<string, unknown>, @Res() res: Response) {
    this.sim.assertEnabled();
    const redirectUri = str(q.redirect_uri);
    if (!this.sim.validRedirect(str(q.client_id), redirectUri)) {
      res
        .status(400)
        .type('html')
        .send(page('Solicitud inválida', '<h1>Solicitud inválida</h1><p>client_id o redirect_uri no permitidos.</p>'));
      return;
    }
    if (str(q.response_type) !== 'code' || str(q.code_challenge_method) !== 'S256' || !str(q.code_challenge)) {
      res
        .status(400)
        .type('html')
        .send(page('Solicitud inválida', '<h1>Solicitud inválida</h1><p>Se requiere PKCE S256.</p>'));
      return;
    }
    const hidden = ['redirect_uri', 'state', 'code_challenge', 'scope']
      .map((k) => `<input type="hidden" name="${k}" value="${esc(str(q[k]))}">`)
      .join('');
    res.type('html').send(
      page(
        'Autorizar a Nexo',
        `<h1>¿Autorizar a Nexo?</h1><p>Nexo solicita acceso de inferencia (<strong>${esc(str(q.scope) || 'inference')}</strong>) a su cuenta simulada.</p>
<form method="post" action="${esc(this.sim.base)}/authorize/decision">${hidden}
<div class="row"><button class="primary" name="decision" value="allow">Autorizar</button><button name="decision" value="deny">Denegar</button></div></form>
<form method="post" action="${esc(this.sim.base)}/revoke-all"><div class="row"><button class="danger">Revocar todas las sesiones</button></div>
<small>Simula que el usuario revoca el acceso en el proveedor: la próxima renovación de Nexo cierra la sesión.</small></form>`,
      ),
    );
  }

  @Post('authorize/decision')
  decision(@Body() b: Record<string, unknown>, @Res() res: Response) {
    this.sim.assertEnabled();
    const redirectUri = str(b.redirect_uri);
    if (!this.sim.validRedirect('nexo-simulador-local', redirectUri)) {
      res.status(400).send('redirect_uri no permitido');
      return;
    }
    const url = new URL(redirectUri);
    if (str(b.state)) url.searchParams.set('state', str(b.state));
    if (str(b.decision) === 'allow') {
      url.searchParams.set('code', this.sim.issueCode(str(b.code_challenge), redirectUri, str(b.scope) || 'inference'));
    } else {
      url.searchParams.set('error', 'access_denied');
    }
    res.redirect(302, url.toString());
  }

  @Post('token')
  token(@Body() b: Record<string, unknown>, @Res() res: Response) {
    this.sim.assertEnabled();
    try {
      const grant = str(b.grant_type);
      const body =
        grant === 'authorization_code'
          ? this.sim.exchangeCode(str(b.code), str(b.redirect_uri), str(b.code_verifier))
          : grant === 'refresh_token'
            ? this.sim.refreshTokens(str(b.refresh_token))
            : grant === 'urn:ietf:params:oauth:grant-type:device_code'
              ? this.sim.pollDevice(str(b.device_code))
              : null;
      if (!body) throw new SimOAuthError('unsupported_grant_type');
      res.json(body);
    } catch (err) {
      if (!(err instanceof SimOAuthError)) throw err;
      res.status(400).json({ error: err.code });
    }
  }

  @HttpCode(200)
  @Post('device/code')
  deviceCode() {
    this.sim.assertEnabled();
    return this.sim.startDevice();
  }

  @Get('device')
  device(@Query('user_code') userCode: string | undefined, @Res() res: Response) {
    this.sim.assertEnabled();
    res.type('html').send(
      page(
        'Conectar dispositivo',
        `<h1>Conectar Nexo con un código</h1><p>Ingrese el código que muestra Nexo y autorice el acceso.</p>
<form method="post" action="${esc(this.sim.base)}/device/decision"><input name="user_code" value="${esc(str(userCode))}" placeholder="XXXX-XXXX" aria-label="Código" required>
<div class="row"><button class="primary" name="decision" value="allow">Autorizar</button><button name="decision" value="deny">Denegar</button></div></form>`,
      ),
    );
  }

  @Post('device/decision')
  deviceDecision(@Body() b: Record<string, unknown>, @Res() res: Response) {
    this.sim.assertEnabled();
    const allow = str(b.decision) === 'allow';
    const ok = this.sim.decideDevice(str(b.user_code), allow);
    res
      .status(ok ? 200 : 400)
      .type('html')
      .send(
        page(
          'Simulador',
          ok
            ? `<h1>${allow ? 'Acceso autorizado' : 'Acceso denegado'}</h1><p>Vuelva a Nexo: ${allow ? 'la conexión se completa sola.' : 'verá que se denegó.'}</p>`
            : '<h1>Código no válido</h1><p>El código no existe, ya se usó o venció.</p>',
        ),
      );
  }

  @HttpCode(200)
  @Post('revoke')
  revoke(@Body() b: Record<string, unknown>) {
    this.sim.assertEnabled();
    this.sim.revoke(str(b.token));
    return {};
  }

  @Post('revoke-all')
  revokeAll(@Res() res: Response) {
    this.sim.assertEnabled();
    this.sim.revokeAll();
    res
      .type('html')
      .send(
        page(
          'Simulador',
          '<h1>Sesiones revocadas</h1><p>La próxima renovación de Nexo recibirá invalid_grant y la conexión quedará con la sesión cerrada.</p>',
        ),
      );
  }

  @Get('v1/models')
  models(@Headers('authorization') auth: string | undefined) {
    this.sim.assertEnabled();
    if (!this.sim.validAccess(auth))
      throw new UnauthorizedException({ error: { message: 'Token inválido o expirado' } });
    return { data: SIM_MODELS.map((id) => ({ id, object: 'model' })) };
  }

  @HttpCode(200)
  @Post('v1/chat/completions')
  chat(@Headers('authorization') auth: string | undefined, @Body() body: Parameters<typeof simulatedCompletion>[0]) {
    this.sim.assertEnabled();
    if (!this.sim.validAccess(auth))
      throw new UnauthorizedException({ error: { message: 'Token inválido o expirado' } });
    return simulatedCompletion(body ?? {});
  }
}
