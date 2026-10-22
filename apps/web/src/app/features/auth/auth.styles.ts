export const AUTH_STYLES = `
  :host { min-height: 100vh; display: grid; grid-template-columns: 1.1fr 1fr; }
  .hero { background: radial-gradient(circle at 20% 20%, #3b3bd6 0, #12142a 60%); color: #fff; padding: 56px; display: flex; flex-direction: column; justify-content: space-between; }
  .hero h1 { font-size: 40px; line-height: 1.1; max-width: 480px; }
  .hero p { color: #c3c6e6; max-width: 460px; font-size: 15px; }
  .features { display: grid; gap: 14px; margin-top: 28px; }
  .features div { display: flex; gap: 12px; align-items: center; color: #dfe1f5; }
  .form-side { display: grid; place-items: center; padding: 32px; }
  form { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 16px; }
  .logo { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #6d6dfa, #9b5cf6); display: grid; place-items: center; font-weight: 800; font-size: 20px; }
  .btn.primary { height: 42px; justify-content: center; }
  @media (max-width: 900px) { :host { grid-template-columns: 1fr; } .hero { display: none; } }
`;

export const AUTH_HERO = `
  <section class="hero">
    <div class="logo">N</div>
    <div>
      <h1>Agentes de IA conectados a todo tu negocio.</h1>
      <p>Nexo conecta APIs REST, web services SOAP, GraphQL y servidores MCP con agentes inteligentes y flujos de automatización.</p>
      <div class="features">
        <div>⚡ Conectores con importación OpenAPI, WSDL y MCP</div>
        <div>🤖 Agentes con herramientas y aprobación humana</div>
        <div>🔀 Flujos visuales con webhooks y programación</div>
        <div>🧩 Servidor MCP propio para Claude, IDEs y otros agentes</div>
      </div>
    </div>
    <small style="color:#8a8fb0">© Nexo</small>
  </section>
`;
