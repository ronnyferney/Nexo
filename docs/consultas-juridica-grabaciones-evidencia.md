# Consultas a Jurídica — Grabaciones y uso de exportaciones firmadas como evidencia

> **Propósito:** elevar a Jurídica **dos consultas separadas** para orientar el diseño de los controles de voz y de las exportaciones verificables.
> **Estado:** **consulta y preparación.** Este documento **no** afirma bases legales, **no** fija plazos de retención, **no** asume valor probatorio y **no** registra aprobación alguna. Toda definición normativa corresponde a Jurídica.

Señores de Jurídica, les planteamos dos consultas que mantenemos **deliberadamente separadas** porque responden a preguntas distintas. La primera es sobre el **tratamiento y retención** de llamadas, grabaciones y transcripciones. La segunda es sobre el **uso como evidencia** de las exportaciones firmadas. Les rogamos responder cada una por su lado.

---

## Consulta (a) — Tratamiento y retención de llamadas, grabaciones y transcripciones

### Contexto técnico actual

Nexo ya tiene construido un control **configurable por empresa** llamado `GrabacionConfig` (en `apps/api/src/modules/channels/voice/grabacion`). Su diseño parte de un principio de prudencia:

- **Todo apagado por defecto.** Sin configuración explícita, **nada** se graba ni se retiene.
- El campo `retencionDias` permanece en **`NULL` = "pendiente de política"** mientras Jurídica no defina plazos. El servicio **no** ejecuta borrados productivos ni declara plazos legales por su cuenta.
- Todo cambio de configuración queda registrado en la auditoría inmutable, con las banderas anterior/nuevo, para que Jurídica pueda comparar el estado antes y después.
- Seguimos construyendo **controles configurables**, sin asumir plazos ni valor probatorio: el software ofrece las palancas; Jurídica define cómo se posicionan.

### Preguntas concretas para Jurídica

1. **Bases legales.** ¿Cuál es la base legal que habilita grabar llamadas y generar transcripciones (p. ej. consentimiento, interés legítimo, obligación contractual)? ¿Varía por empresa del grupo, por país del interlocutor o por tipo de llamada (entrante/saliente)?
2. **Deber de información.** ¿Qué aviso debe darse al interlocutor y en qué momento (locución inicial, texto, doble consentimiento)? ¿Debe quedar registrado el aviso?
3. **Plazos de retención.** ¿Qué valor debe tomar `retencionDias` por tipo de dato (audio crudo, transcripción, metadatos) y por empresa? ¿Hay plazos máximos y mínimos, y difieren por jurisdicción?
4. **Finalidad.** ¿Para qué finalidades puede usarse la grabación/transcripción, y qué usos quedan expresamente excluidos?
5. **Roles con acceso.** ¿Qué roles pueden escuchar audio o leer transcripciones? ¿Se requiere registro de cada acceso?
6. **Eliminación.** Al cumplirse el plazo, ¿la eliminación debe ser automática o requiere validación humana? ¿Debe quedar constancia auditable del borrado?
7. **Transcripciones frente a audio.** ¿Aplican a la transcripción las mismas reglas que al audio, o puede retenerse la transcripción con plazos distintos?

> Mientras Jurídica no responda, `retencionDias` sigue en `NULL` ("pendiente de política") y no se habilita grabación productiva.

---

## Consulta (b) — Uso de exportaciones firmadas como evidencia ("Pasaporte de resultado")

### Contexto técnico actual

Nexo genera exportaciones verificables de resultados: cada exportación lleva un **hash** y un **ancla de auditoría** que la vincula a la cadena inmutable de la plataforma (el "**Pasaporte de resultado**", base en ADR 0014). Técnicamente esto permite demostrar que un contenido no fue alterado después de su emisión y que procede de una cadena auditable.

**No** asumimos que ello tenga valor probatorio automático ante terceros. Precisamente por eso consultamos.

### Preguntas concretas para Jurídica

1. **Valor probatorio.** ¿Bajo qué condiciones una exportación firmada (hash + ancla de auditoría) podría considerarse evidencia válida ante un tercero, un auditor o una autoridad? ¿Qué le falta hoy para ello?
2. **Requisitos de firma.** ¿Basta un hash anclado a la cadena interna, o se requiere firma electrónica/digital cualificada, sellado de tiempo de un tercero de confianza, u otro mecanismo?
3. **Cadena de custodia.** ¿Qué elementos de cadena de custodia debe acreditar la exportación (quién la generó, cuándo, con qué insumos, qué aprobaciones hubo)?
4. **Conservación del original.** Para sostener la validez de la exportación, ¿debe conservarse el insumo original (llamada, documento) y por cuánto tiempo?
5. **Alcance de las declaraciones.** ¿Qué puede y qué **no** puede afirmar la plataforma sobre una exportación (p. ej. evitar la frase "tiene valor probatorio")?
6. **Diferencias por jurisdicción.** ¿Cambian estos requisitos según el país donde se pretenda hacer valer la evidencia?

### Postura de ingeniería mientras tanto

Seguiremos construyendo controles configurables (firma, anclaje, conservación de insumos) **sin** asumir plazos ni valor probatorio, de modo que, cuando Jurídica defina los requisitos, el posicionamiento sea cuestión de configuración y no de reconstrucción.

---

## Lo que estas consultas NO hacen

- No afirman que exista una base legal ni un plazo concreto.
- No declaran valor probatorio de ninguna exportación.
- No activan grabación productiva ni fijan `retencionDias`.
- No registran aprobaciones ni compromisos.

---

**Estado del documento:** consulta — **pendiente de respuesta de Jurídica** (consulta a y consulta b por separado).
