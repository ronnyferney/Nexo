/**
 * Estilos y bloques compartidos de las pantallas de acceso (Kit de Marca NEXO).
 * Las variables --brand-* se definen en styles.scss; aquí se usan con valor de respaldo.
 * Lockup de marca: insignia circular + «Nexo» (Inter 800) + «AI Agents Platform» en tipo oración (≈55 % del tamaño),
 * compuesto con texto real para accesibilidad y nitidez.
 */
export const AUTH_STYLES = `
  :host { min-height: 100vh; display: grid; grid-template-columns: 1.1fr 1fr; }
  .hero { position: relative; overflow: hidden; isolation: isolate; background: var(--brand-navy, #08102D); color: #fff; padding: 48px 56px; display: flex; flex-direction: column; justify-content: space-between; gap: 40px; }
  /* Acento sutil de la órbita: anillo elíptico y halo con el gradiente de marca, lejos del logo. */
  .hero::before { content: ''; position: absolute; z-index: -1; width: 760px; height: 300px; right: -260px; bottom: 70px; border-radius: 50%; border: 1.5px solid rgba(22, 199, 244, 0.22); box-shadow: 0 0 60px rgba(18, 91, 234, 0.18), inset 0 0 40px rgba(133, 80, 233, 0.12); transform: rotate(-18deg); pointer-events: none; }
  .hero::after { content: ''; position: absolute; z-index: -1; inset: 0; pointer-events: none; background: radial-gradient(55% 45% at 100% 100%, rgba(133, 80, 233, 0.22), transparent 70%), radial-gradient(45% 40% at 85% 70%, rgba(18, 91, 234, 0.2), transparent 70%); }
  .lockup { display: flex; align-items: center; gap: 16px; }
  .lockup img { display: block; flex-shrink: 0; }
  .lockup-text { display: flex; flex-direction: column; gap: 2px; }
  .lockup-name { font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -0.01em; }
  .lockup-descriptor { font-size: 24px; font-weight: 400; line-height: 1.15; }
  .hero .lockup img { width: 76px; height: 76px; }
  .hero .lockup-name { color: #fff; }
  .hero .lockup-descriptor { color: #a9b1d6; }
  .claim { margin: 0 0 16px; font-size: 40px; line-height: 1.12; font-weight: 700; letter-spacing: -0.01em; max-width: 520px; }
  .claim span { display: block; color: var(--brand-cyan, #16C7F4); background: var(--brand-gradient, linear-gradient(135deg, #125BEA, #16C7F4, #8550E9)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .lead { color: #c9d1ec; max-width: 480px; font-size: 15px; margin: 0; }
  .features { list-style: none; padding: 0; display: grid; gap: 14px; margin: 28px 0 0; }
  .features li { display: flex; gap: 12px; align-items: center; color: #e1e6f8; }
  .features nx-icon { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; color: var(--brand-cyan, #16C7F4); background: rgba(18, 91, 234, 0.2); box-shadow: inset 0 0 0 1px rgba(22, 199, 244, 0.2); }
  .hero small { color: #a3acd3; }
  .form-side { display: grid; place-items: center; padding: 32px; }
  form { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 16px; }
  form h1 { margin: 0; }
  /* Lockup para pantallas angostas (el panel de marca se oculta): colores según el esquema. */
  .brand-compact { display: none; gap: 12px; margin-bottom: 8px; }
  .brand-compact img { width: 52px; height: 52px; }
  .brand-compact .lockup-name { font-size: 30px; color: #0b0f1f; }
  .brand-compact .lockup-descriptor { font-size: 16.5px; color: #676b7a; }
  @media (prefers-color-scheme: dark) { .brand-compact .lockup-name { color: #fff; } .brand-compact .lockup-descriptor { color: #a9b1d6; } }
  .btn.primary { height: 42px; justify-content: center; }
  @media (max-width: 900px) { :host { grid-template-columns: 1fr; } .hero { display: none; } .brand-compact { display: flex; } }
`;

export const AUTH_HERO = `
  <section class="hero" aria-labelledby="auth-claim">
    <div class="lockup">
      <img src="brand/insignia-240.png" width="76" height="76" alt="" />
      <div class="lockup-text"><span class="lockup-name">Nexo</span><span class="lockup-descriptor" lang="en">AI Agents Platform</span></div>
    </div>
    <div>
      <p class="claim" id="auth-claim">Conectamos inteligencias. <span>Orquestamos resultados.</span></p>
      <p class="lead">Nexo une sus APIs REST, servicios SOAP, GraphQL y servidores MCP con agentes de IA y flujos de automatización.</p>
      <ul class="features">
        <li><nx-icon name="plug" />Conectores con importación OpenAPI, WSDL y MCP</li>
        <li><nx-icon name="bot" />Agentes con herramientas y aprobación humana</li>
        <li><nx-icon name="flow" />Flujos visuales activados por eventos o por calendario</li>
        <li><nx-icon name="server" />Servidor MCP propio para Claude, entornos de desarrollo y otros agentes</li>
      </ul>
    </div>
    <small>© Nexo</small>
  </section>
`;

/** Lockup compacto para pantallas angostas: texto oscuro en esquema claro y blanco en esquema oscuro. */
export const AUTH_BRAND_COMPACT = `
  <div class="lockup brand-compact">
    <img src="brand/insignia-240.png" width="52" height="52" alt="" />
    <div class="lockup-text"><span class="lockup-name">Nexo</span><span class="lockup-descriptor" lang="en">AI Agents Platform</span></div>
  </div>
`;
