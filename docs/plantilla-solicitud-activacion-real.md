# Plantilla — Solicitud de activación real de canal (correo y WhatsApp)

> **Propósito:** ofrecer el **formulario** que debe diligenciarse y presentarse **antes** de solicitar la activación real de un canal de correo (M365/Gmail) o WhatsApp (Meta).
> **Estado:** **plantilla de preparación.** Diligenciar este formulario **no** activa nada y **no** constituye autorización. La **activación productiva queda PENDIENTE de autorización específica del patrocinador.**

## 0. Nota destacada (leer antes de diligenciar)

- La **activación productiva** de cualquier canal queda **PENDIENTE de autorización específica del patrocinador**. Esta plantilla prepara la solicitud; no la aprueba.
- Las **credenciales se cargan por el medio seguro (bóveda)**, con la referencia `{{ secrets.NOMBRE }}`. **Nunca** se envían por chat, correo ni se escriben en este documento.
- El patrocinador distingue cuatro autorizaciones independientes (construir / acceso a cuentas y datos / gasto / activación productiva). Esta solicitud toca **acceso** y **activación productiva**, y puede implicar **gasto**: cada una requiere su propia autorización.

## 1. Checklist previo (todo debe estar en "Sí" antes de presentar)

- [ ] Hay un **responsable humano (titular)** identificado para el buzón o número.
- [ ] Están definidos los **permisos requeridos** y el **rol mínimo** necesario (no más del necesario).
- [ ] La lista de **destinatarios de prueba** es acotada y, de ser posible, **interna**.
- [ ] Están identificados los **costos estimados** y **quién los aprueba** (si aplica gasto).
- [ ] Está documentado el **procedimiento de desactivación** (cómo se apaga y quién puede hacerlo).
- [ ] Las **credenciales** se cargarán por **bóveda**, no por chat.
- [ ] Se cuenta (o se tramitará por separado) con la **autorización del patrocinador** para activación productiva.

Si algún punto no está en "Sí", la solicitud **no** se presenta todavía.

## 2. Campos obligatorios del formulario

| Campo | Descripción | A diligenciar |
|---|---|---|
| Empresa | Empresa del grupo a la que pertenece el canal. | |
| Canal | Correo M365 / Correo Gmail / WhatsApp Meta. | |
| Buzón o número | Dirección de correo o número de WhatsApp a activar. | |
| Responsable humano (titular) | Persona dueña del buzón/número y responsable de su uso. | |
| Permisos requeridos | Alcances/permisos exactos que la integración necesita. | |
| Rol mínimo | Rol mínimo con el que operará (principio de menor privilegio). | |
| Destinatarios de prueba | Lista acotada, idealmente interna, para la fase de prueba. | |
| Costos estimados | Costo previsto del canal/uso. **No inventar:** (pendiente de cotización) si no se conoce. | |
| Quién aprueba los costos | Área o persona que autoriza el gasto (Finanzas / patrocinador). | |
| Procedimiento de desactivación | Cómo se apaga el canal y **quién** está autorizado a hacerlo. | |
| Referencia de credenciales | Nombre de la variable en bóveda (`{{ secrets.NOMBRE }}`). **Nunca** el valor. | |

## 3. Tabla vacía lista para diligenciar por empresa

| Empresa | Canal | Buzón/Número | Responsable (titular) | Permisos / Rol mínimo | Destinatarios de prueba | Costos estimados / Aprueba | Procedimiento de desactivación | Ref. credenciales (bóveda) |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  | (pendiente de cotización) / |  | `{{ secrets. }}` |
|  |  |  |  |  |  | (pendiente de cotización) / |  | `{{ secrets. }}` |
|  |  |  |  |  |  | (pendiente de cotización) / |  | `{{ secrets. }}` |

## 4. Qué ocurre después de presentar el formulario

1. Revisión de completitud (checklist de la sección 1).
2. Tramitación de las autorizaciones pendientes por separado: **acceso a cuentas y datos**, **gasto** (si aplica) y **activación productiva** del patrocinador.
3. Carga de credenciales por **bóveda**.
4. Solo entonces, y con la autorización del patrocinador, se procede a la activación real.

## 5. Lo que esta plantilla NO hace

- No activa ningún canal por sí sola.
- No autoriza acceso, gasto ni activación productiva.
- No solicita ni almacena contraseñas o secretos (van por bóveda).
- No inventa costos: donde falten, dice "(pendiente de cotización)".

---

**Estado del documento:** plantilla — la **activación productiva queda PENDIENTE de autorización específica del patrocinador.**
