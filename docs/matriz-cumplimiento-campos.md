# Matriz de cumplimiento — propuesta de campos para aprobación (v2)

> **Propósito:** presentar, para la **aprobación definitiva del patrocinador**, los **campos obligatorios**, las
> **reglas de validación** y los **controles de protección de datos** que la **matriz de cumplimiento configurable**
> (motor P1.3 · **ADR 0020**) podría exigir, organizados por **jurisdicción / sector económico / proceso / nivel de
> riesgo**.
> **Estado:** **propuesta — pendiente de aprobación del patrocinador.** El **motor ya está construido** (reglas
> configurables + resolución + validación **asesora, no bloqueante**), pero **todas las reglas nacen INACTIVAS**: no se
> exige ningún campo hasta que un ADMIN las active **después** de que el patrocinador apruebe este conjunto. Este
> documento **no** afirma conformidad con ninguna norma y **no** compromete plazos.
>
> **Aprobación del patrocinador (2026-11-03):** el **conjunto de campos** de §3 (transversales) y §4 (ejemplos por
> sector) queda **APROBADO** por el patrocinador (Ing. R. Garzón) como catálogo inicial. Esta aprobación es del
> **catálogo de campos**; **no** activa reglas por sí misma. Las reglas siguen **inactivas** hasta definir (pendiente):
> (2) cuáles nacen activas, (3) jurisdicciones a cubrir primero, (4) confirmación de modo **asesor (no bloqueante)**.

## 1. Qué cambió respecto de la v1

La v1 era una lista de **campos candidatos** para el Pasaporte (ADR 0014), sin motor. Ahora existe un **motor
configurable y multisectorial** (ADR 0020): cada requisito se expresa como una fila `ReglaCumplimiento` con un
**alcance** (jurisdicción/sector/proceso/riesgo; cualquiera vacío = **comodín**, aplica a todos), un **campo
obligatorio** (`campoClave` + `tipoDato`), una **regla de validación** declarativa opcional y un **control de
protección de datos** aplicable. Esta v2 **propone el contenido** de esas filas para su aprobación.

Guardarraíl (decisiones del patrocinador §4): **NEXO es multisectorial**. Los sectores de abajo (financiero/cobranza,
salud, retail) son **ejemplos ilustrativos** para mostrar la generalidad del motor; **no** atan el motor a ninguno y
**no** son una lista cerrada. Añadir una jurisdicción/sector/proceso nuevo es **crear filas**, no tocar código.

## 2. Cómo se lee cada regla propuesta

- **Alcance:** jurisdicción / sector / proceso / nivel de riesgo. Vacío = **todos** (comodín). «La más específica
  **suma**»: al resolver un contexto se acumulan todos los campos aplicables; si dos reglas chocan en un mismo campo,
  gana la de alcance más específico.
- **campoClave / tipoDato:** identificador del dato (en inglés) y su forma (TEXTO, NUMERO, BOOLEANO, FECHA, LISTA,
  OBJETO). El tipo describe **forma**, no semántica sectorial.
- **reglaValidacion (declarativa):** `{ requerido, patron, min, max, enum, longitudMin, longitudMax }`. Sin código
  ejecutable; el evaluador la interpreta de forma acotada.
- **controlProteccion:** control de protección de datos aplicable (texto/clave, p. ej. `minimización`,
  `consentimiento`, `seudonimización`). Se **declara**; la ejecución real de retención/enmascarado vive en
  `data-protection` (ADR 0008).

## 3. Campos transversales propuestos (comodín: aplican a todo sector/jurisdicción)

| campoClave | tipoDato | reglaValidacion (propuesta) | controlProteccion | Motivo (hipótesis a validar) |
|---|---|---|---|---|
| `clasificacionDatos` | TEXTO | `{ enum: ['publico','interno','confidencial','reservado'] }` | `minimización` | Marcar la sensibilidad del contenido del resultado. |
| `jurisdiccionAplicable` | TEXTO | `{ requerido: true }` | — | Bajo qué marco se produjo y debe interpretarse el resultado. |
| `baseLegalTratamiento` | TEXTO | `{ requerido: true }` | `base-legal` | Base legal invocada para el tratamiento asociado. |
| `supervisionHumanaRegistrada` | BOOLEANO | `{ requerido: true }` | `supervisión-humana` | Constancia de intervención humana en decisiones con impacto. |

## 4. Ejemplos por sector (ILUSTRATIVOS — generalidad del motor)

### 4.1 Financiero / proceso «cobranza»

| Alcance | campoClave | tipoDato | reglaValidacion (propuesta) | controlProteccion |
|---|---|---|---|---|
| sector=financiero | `identificadorFiscal` | TEXTO | `{ requerido: true, patron: '^[0-9]{10,13}$' }` | `seudonimización` |
| sector=financiero · proceso=cobranza | `consentimientoContacto` | BOOLEANO | `{ requerido: true }` | `consentimiento` |
| sector=financiero · proceso=cobranza | `horarioContactoPermitido` | BOOLEANO | `{ requerido: true }` | — |
| sector=financiero · proceso=cobranza · riesgo=ALTO | `revisionHumanaPrevia` | BOOLEANO | `{ requerido: true }` | `supervisión-humana` |
| sector=financiero | `retencionEvidenciaDias` | NUMERO | `{ min: 365, max: 3650 }` | `retención` |

### 4.2 Salud

| Alcance | campoClave | tipoDato | reglaValidacion (propuesta) | controlProteccion |
|---|---|---|---|---|
| sector=salud | `consentimientoDatosPersonales` | BOOLEANO | `{ requerido: true }` | `consentimiento` |
| sector=salud | `categoriaDatoSensible` | TEXTO | `{ enum: ['salud','genetico','biometrico'] }` | `datos-sensibles` |
| sector=salud · proceso=onboarding | `baseLegalTratamiento` | TEXTO | `{ requerido: true }` | `base-legal` |
| sector=salud · riesgo=ALTO | `evaluacionImpactoRealizada` | BOOLEANO | `{ requerido: true }` | `evaluación-impacto` |

### 4.3 Retail

| Alcance | campoClave | tipoDato | reglaValidacion (propuesta) | controlProteccion |
|---|---|---|---|---|
| sector=retail | `clasificacionDatos` | TEXTO | `{ enum: ['publico','interno','confidencial'] }` | `minimización` |
| sector=retail · proceso=marketing | `consentimientoMarketing` | BOOLEANO | `{ requerido: true }` | `consentimiento` |
| sector=retail · proceso=marketing | `canalContacto` | TEXTO | `{ enum: ['correo','whatsapp','sms'] }` | — |
| sector=retail | `politicaEliminacion` | TEXTO | `{ requerido: true }` | `eliminación-segura` |

## 5. Ejemplo de resolución (cómo «suma» la matriz)

Contexto `sector=financiero, proceso=cobranza, riesgo=ALTO` resuelve la **unión** de: los transversales (§3) + los de
`sector=financiero` + los de `financiero·cobranza` + el de `financiero·cobranza·ALTO`. Un contexto `sector=retail` no ve
nada de financiero/salud: solo transversales + retail.

## 6. Qué pedimos al patrocinador (aprobación 3b)

1. **Aprobar / ajustar** los campos, tipos, reglas y controles de §3–§4 (o un subconjunto) como **conjunto inicial**.
2. Indicar **por cada regla** si debe nacer **activa** tras la aprobación o permanecer en estudio.
3. Confirmar **jurisdicciones** concretas a cubrir primero (hoy el alcance `jurisdiccion` es texto libre, sin taxonomía
   impuesta).
4. Confirmar que, por ahora, la evaluación sigue siendo **asesora (no bloqueante)**; el **modo bloqueante** (ADR 0020
   Inc.3) requeriría una **autorización de activación productiva** aparte.

## 6-bis. Decisiones del patrocinador (2026-11-03) — configuración inicial aprobada

Sobre el catálogo ya aprobado (§3–§4), el patrocinador definió la **configuración inicial de activación**:

1. **Reglas activas:** **solo los 4 campos transversales de §3** (`clasificacionDatos`, `jurisdiccionAplicable`,
   `baseLegalTratamiento`, `supervisionHumanaRegistrada`). Los ejemplos por sector de §4 quedan **aprobados pero
   inactivos** (en estudio), listos para activar cuando el patrocinador lo indique.
2. **Jurisdicción inicial:** **Colombia (CO)**. La activación inicial se acota a contextos de Colombia; ampliar a otras
   jurisdicciones (p. ej. EC) o volverlas comodín es **crear/editar filas**, sin tocar código.
3. **Modo:** **asesor (no bloqueante)** confirmado. La matriz informa faltantes/incumplimientos pero **no impide**
   emitir ni aceptar resultados. El **modo bloqueante** (ADR 0020 Inc.3) sigue **diferido**: requeriría una autorización
   de activación productiva aparte.

Materialización: estas 4 reglas se cargan como **configuración de datos por workspace** (idempotente, parametrizada por
`workspaceId`; nada hardcodeado por empresa), con `activa = true` y modo asesor. No se registra conformidad con ninguna
norma; son controles técnicos configurables.

## 7. Lo que esta propuesta NO hace

- No activa ninguna regla: todas nacen **inactivas**; nada se exige hasta la aprobación del patrocinador + activación por
  un ADMIN.
- No afirma conformidad con ninguna norma ni certifica conformidad sectorial.
- No bloquea la emisión/aceptación de resultados (la validación es **asesora**).
- No ata el motor a ningún sector: los ejemplos son ilustrativos y reemplazables por configuración.

---

**Estado del documento:** propuesta para **aprobación definitiva del patrocinador**. El motor (ADR 0020) y el Pasaporte
base (ADR 0014) continúan; las reglas permanecen **inactivas** hasta que el patrocinador apruebe este conjunto.
