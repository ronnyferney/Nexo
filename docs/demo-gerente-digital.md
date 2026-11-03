# Demostración funcional integral · Gerente digital

Guion reproducible de una **validación integral** del coordinador de misiones (ADR 0016 · compuerta E-B): un **gerente
digital** (empleado digital de nivel `SUPEREMPLEADO`) recibe un objetivo, coordina varios agentes subordinados, propone
la distribución de tareas, supervisa resultados, identifica un bloqueo, lo escala y presenta un informe gerencial. Todo
en **ambiente controlado** y con **datos sintéticos**, verificando la **trazabilidad** de cada acción.

Pensado para que el patrocinador lo reproduzca o lo revise. El recorrido vive como prueba e2e determinista en
`apps/api/test/demo-gerente-digital.e2e-spec.ts`.

## Qué demuestra

1. **Gating (compuerta E-B).** Con el flag `Workspace.coordinadorGobiernoActivo` **apagado** (valor por defecto), el
   gerente digital **no produce ningún efecto**: ni eventos de misión, ni auditoría, ni informe. Se enciende **solo** en
   el workspace sintético de la demo (ambiente controlado); jamás en datos reales.
2. **Recibir un objetivo.** Un humano crea y **autoriza** la misión transversal; ningún agente lo hace.
3. **Coordinar.** El gerente digital **propone** asignaciones de tareas dentro de su nivel y alcance, y **solo
   transfiere permisos que él mismo posee** (no concede acceso, ADR 0007/0014). Aplicar una asignación es de alto
   impacto: pasa por la **bandeja de aprobaciones E6** y la aprueba un **ADMIN distinto** (aprobación humana explícita).
4. **No autoaprobación ni presupuesto (QA13).** El coordinador no aprueba su propia acción de alto impacto (se bloquea y
   audita) ni mueve/compromete presupuesto por su cuenta.
5. **Supervisar y escalar.** Observa **solo metadatos** de desempeño (no contenido), hace seguimiento de compromisos,
   detecta un **bloqueo** sintético y, al no haber regla inequívoca, **detiene y escala** a decisión humana (QA10).
6. **Informe gerencial.** El `executive-report` consolida estado, avance, compromisos/vencimientos, bloqueos y lo
   pendiente de decisión humana, de **solo lectura** (no mueve nada).
7. **Trazabilidad (E13).** Cada acción queda en la auditoría inmutable; la **cadena por hash** del workspace permanece
   íntegra y una manipulación se **detecta** en el `seq` exacto.

Garantías de gobierno de la demo: **sin gasto**, **sin canales reales**, **sin LLM de pago** (los agentes usan el
proveedor `mock`). Ninguna acción crítica se auto-ejecuta: el coordinador **propone y solicita**; un humano decide.

## Datos sintéticos

Se crean en un workspace nuevo y aislado (un `registerOwner` por ejecución; nada se mezcla con datos reales):

| Elemento | Detalle |
|---|---|
| Patrocinador (humano) | OWNER del workspace; crea y autoriza la misión, origina las solicitudes E6. |
| Aprobador (humano) | ADMIN de prueba **distinto**: aprueba en la bandeja E6 (no autoaprobación). |
| Gerente Digital Nexo | Agente coordinador, `Cargo` nivel `SUPEREMPLEADO`, proveedor `mock`. |
| Agente Cobranza | Subordinado, `Cargo` nivel `JEFE`. |
| Agente Jurídico | Subordinado, `Cargo` nivel `LIDER`. |
| Objetivo | «Reducir cartera vencida Q4» (indicador, línea base 1M, meta 600k). |
| Tarea de cobranza | Con `ContratoResultado` de `RESULTADO_NEGOCIO` comprometido. |
| Tarea jurídica | Terminará **BLOQUEADA** con un incumplimiento abierto (bloqueo sintético). |
| Tarea vencida | Plazo ya vencido → compromiso `VENCIDO` + bloqueo `DEPENDENCIA_VENCIDA`. |

## Cómo ejecutarla

Requiere Postgres y Redis (los de la suite e2e). Desde la raíz del repo:

```bash
docker compose up -d postgres redis            # o los servicios equivalentes de la suite
cd apps/api
NODE_OPTIONS=--max-old-space-size=4096 \
  npx jest --config ./test/jest-e2e.json --runInBand test/demo-gerente-digital.e2e-spec.ts
```

Es **opt-in**: al apuntar a ese único archivo no se corre el resto de la suite. La prueba crea su propio workspace,
enciende el flag **solo ahí**, y al terminar lo **vuelve a apagar** (no deja gobierno encendido ni datos corruptos).

> Nota: el servicio del coordinador (`MissionCoordinatorGovernanceService`) aún no expone API HTTP (está cableado pero
> gobernado por la compuerta E-B); por eso el guion reproducible es la prueba e2e, que invoca el servicio y los
> endpoints reales contra PG/Redis, y no un script HTTP tipo `scripts/demo-*.mjs`.

## Recorrido paso a paso

- **Paso 0** — Prepara la empresa sintética (cargos, gerente digital, subordinados, objetivo y tres tareas).
- **Paso 0b** — *Gating*: con el flag apagado, `seguimientoCompromisos` devuelve `aplicado:false`, el informe devuelve
  `disponible:false` con motivo `GOBIERNO_COORDINADOR_DESACTIVADO`, y no se escribe ningún evento ni auditoría.
- **Paso A** — Enciende el flag en el workspace sintético; crea la misión (`PROPUESTA`) y la **autoriza** (`AUTORIZADA`);
  declara el participante (alcance) y vincula objetivo y tareas por referencia.
- **Paso B** — El gerente digital **propone** dos asignaciones dentro de permisos; cada una deja una
  `DECISION_HUMANA_SOLICITADA`. Se comprueba que no concede `tesoreria:transferir` (no lo posee).
- **Paso B2** — La **aplicación** de la asignación pasa por la bandeja E6: el patrocinador la solicita, no puede
  autoaprobarla (400) y un **ADMIN distinto** la **aprueba** (`APROBADA`).
- **Paso B3** — **QA13**: la autoaprobación del coordinador se **bloquea** (`ForbiddenException`) y audita; un movimiento
  de presupuesto originado por el coordinador **exige aprobación humana** y nunca se aplica solo.
- **Paso C** — **Supervisa** (solo metadatos; descarta `contenidoSensible`), hace **seguimiento** de compromisos, y
  detecta un **bloqueo** sobre la tarea jurídica (incumplimiento + tarea BLOQUEADA) que, sin regla inequívoca,
  **detiene y escala** (severidad `ALTA`, decisión humana).
- **Paso D** — Genera el **informe ejecutivo**: estado `AUTORIZADA` (el coordinador no cambió el estado), 1 objetivo y 3
  tareas, 1 contrato de negocio, el compromiso `VENCIDO`, los bloqueos (`INCUMPLIMIENTO`, `TAREA_BLOQUEADA`,
  `DEPENDENCIA_VENCIDA`) y ≥3 pendientes de decisión humana.
- **Paso E** — **Trazabilidad**: verifica que cada acción quedó auditada y que la cadena por hash está íntegra.
- **Paso E2** — Prueba negativa de inmutabilidad: altera una entrada, la verificación la **detecta** en su `seq`, y se
  restaura para dejar la cadena sana.

## Cómo verificar la trazabilidad

Cada capacidad del coordinador escribe en la auditoría inmutable (E13) con `targetId` = id de la misión. La demo afirma
explícitamente la presencia de estas acciones (consultables vía `GET /auditoria?action=<ACCION>&targetId=<misionId>`):

| Acción auditada | Qué evidencia |
|---|---|
| `MISION_CREADA` / `MISION_AUTORIZADA` | El humano recibió el objetivo y autorizó la misión. |
| `MISION_COORDINADOR_ASIGNACION` (×2) | Propuestas de distribución de tareas. |
| `MISION_COORDINADOR_SUPERVISION` | Observación de metadatos de desempeño. |
| `MISION_COORDINADOR_SEGUIMIENTO` | Consolidación del estado de compromisos. |
| `MISION_COORDINADOR_BLOQUEO` | Detección del bloqueo. |
| `MISION_COORDINADOR_DECISION_SOLICITADA` | Escalamiento a decisión humana. |
| `MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA` | Intento de autoaprobación rechazado (QA13). |

La integridad de la cadena se comprueba con `AuditService.verificarCadena(workspaceId)`, que recomputa cada
`contentHash`/`hash` y valida el enlace `prevHash`/`seq`; devuelve `{ ok: true }` cuando nadie alteró ni borró un hecho,
y `{ ok: false, rotaEnSeq }` en la primera rotura.
