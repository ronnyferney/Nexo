# Solicitud a Finanzas — Umbrales, exposición acumulada y controles de fraccionamiento

> **Propósito:** solicitar a Finanzas la **definición** de los parámetros económicos que gobernarán las acciones con impacto monetario de los empleados digitales.
> **Estado:** **solicitud y preparación.** Este documento **no** registra aprobaciones, **no** autoriza gasto ni activación productiva y **no** fija cifras. Los valores aquí señalados como "(pendiente de definición de Finanzas)" deben provenir exclusivamente de Finanzas.

## 1. Para qué le escribimos

Señores de Finanzas, la plataforma Nexo ya tiene construidos los mecanismos técnicos de control de acciones sensibles (ver sección 4). Lo que **falta** no es software: son los **parámetros de negocio** que solo Finanzas puede establecer. Mientras esos parámetros no estén validados por ustedes, **ninguna acción monetaria se ejecuta de forma autónoma**: todas las pruebas se realizan con **aprobación humana obligatoria**.

Les pedimos, de manera concreta, definir tres bloques de parámetros:

1. **Umbrales por empresa y por moneda** — a partir de qué monto una acción con impacto económico requiere aprobación, y de qué nivel.
2. **Exposición acumulada** — límites agregados por período (diario, semanal, mensual) por empresa, línea de negocio y moneda.
3. **Controles de fraccionamiento** — reglas para impedir que una acción se divida en varias más pequeñas con el fin de evadir un umbral.

## 2. Principio de gobierno que respetamos

El patrocinador distingue cuatro tipos de autorización independientes: **construir**, **acceso a cuentas y datos**, **gasto** y **activación productiva**. Una no implica las demás. Esta solicitud pertenece a la preparación del control de **gasto**; no presume ninguna de las otras tres ni asume que, por estar construido el mecanismo, el gasto autónomo quede habilitado.

## 3. Campos a definir por Finanzas

Las siguientes tablas enumeran los parámetros requeridos. Todos los valores de ejemplo son **ilustrativos** y **no** constituyen una propuesta de cifra; sirven únicamente para mostrar el formato esperado.

### 3.1 Umbrales por empresa y por moneda

| Campo | Descripción | Ejemplo (ilustrativo) | Quién define |
|---|---|---|---|
| `empresaId` | Empresa del grupo a la que aplica el umbral. | (empresa del catálogo) | Finanzas |
| `moneda` | Moneda del umbral (ISO 4217). | COP, USD | Finanzas |
| `montoSinAprobacion` | Monto máximo que **no** requiere aprobación (tope para acción directa). | (pendiente de definición de Finanzas) | Finanzas |
| `montoAprobacionEditor` | Monto hasta el cual basta la aprobación de un rol EDITOR. | (pendiente de definición de Finanzas) | Finanzas |
| `montoAprobacionAdmin` | Monto a partir del cual se exige aprobación de ADMIN o superior. | (pendiente de definición de Finanzas) | Finanzas |
| `montoBloqueado` | Monto a partir del cual la acción se bloquea y escala fuera de la plataforma. | (pendiente de definición de Finanzas) | Finanzas |

### 3.2 Exposición acumulada (límites agregados por período)

| Campo | Descripción | Ejemplo (ilustrativo) | Quién define |
|---|---|---|---|
| `ambito` | Nivel de agregación del límite. | empresa / línea / sede | Finanzas |
| `periodo` | Ventana de acumulación. | diario / semanal / mensual | Finanzas |
| `moneda` | Moneda del límite agregado. | COP, USD | Finanzas |
| `limiteAcumulado` | Monto total permitido en el período, sumando todas las acciones del ámbito. | (pendiente de definición de Finanzas) | Finanzas |
| `accionAlSuperar` | Qué ocurre al alcanzar el límite. | requerir aprobación / bloquear / solo alertar | Finanzas |
| `reinicioPeriodo` | Momento de reinicio del contador. | inicio de día hábil / lunes / día 1 | Finanzas |

### 3.3 Controles de fraccionamiento (anti-división)

| Campo | Descripción | Ejemplo (ilustrativo) | Quién define |
|---|---|---|---|
| `ventanaDeteccion` | Período dentro del cual se agrupan acciones relacionadas para sumarlas. | (pendiente de definición de Finanzas) | Finanzas |
| `criterioAgrupacion` | Qué define que varias acciones son "la misma" para efectos de fraccionamiento. | mismo destinatario / mismo concepto / mismo agente | Finanzas, con apoyo de Jurídica |
| `umbralAgrupado` | Monto que, al sumarse las acciones agrupadas, dispara el mismo control que un umbral individual. | (pendiente de definición de Finanzas) | Finanzas |
| `accionAlDetectar` | Qué ocurre ante un patrón de fraccionamiento. | requerir aprobación / bloquear / alertar y auditar | Finanzas |

## 4. Lo que ya está construido (y por qué sirve de red de seguridad)

Mientras Finanzas no valide los parámetros anteriores, las acciones monetarias **no** operan de forma autónoma. En las pruebas se usa **siempre** aprobación humana, apoyada en mecanismos ya implementados en Nexo:

- **Mecanismo de aprobaciones (E6)** — flujo de aprobación/rechazo humano previo a ejecutar una acción, con registro en auditoría inmutable. Implementado en `apps/api/src/modules/governance/actions/approvals.service.ts` y las reglas de aprobación en `apps/api/src/modules/governance/policy/approval.rules.ts`.
- **Catálogo de acciones sensibles con niveles de riesgo** — cada acción con impacto está clasificada por nivel de riesgo, lo que determina qué aprobación exige. Implementado en `apps/api/src/modules/governance/actions/sensitive-actions.catalog.ts`, `sensitive-actions.service.ts` y `riesgo.rules.ts`.

> Nota: en la nomenclatura interna estos controles viven bajo `governance/actions` y `governance/policy`; funcionalmente corresponden a los módulos de "aprobaciones" y "acciones sensibles" referidos en esta solicitud.

Estos mecanismos permiten correr pruebas de extremo a extremo **sin** habilitar gasto autónomo: cada acción económica se detiene a la espera de una persona.

## 5. Qué pedimos y qué seguirá pasando mientras tanto

1. Que Finanzas complete las tablas de la sección 3, indicando por cada celda el valor o, si procede, una regla de cálculo.
2. Que Finanzas señale el procedimiento de revisión y actualización de estos parámetros en el tiempo.
3. Hasta que ello ocurra, el estado operativo es: **pendiente de definición de Finanzas**. No se habilitan acciones monetarias autónomas; toda prueba usa aprobación humana.

## 6. Lo que esta solicitud NO hace

- No autoriza gasto ni lo presume aprobado.
- No activa ningún canal productivo.
- No inventa precios, montos ni límites: todos provienen de Finanzas.
- No asume plazos ni compromisos legales.

---

**Estado del documento:** solicitud — **pendiente de definición de Finanzas.**
