# Matriz de campos candidatos del Pasaporte — Cumplimiento

> **Propósito:** preparar una **matriz de campos adicionales candidatos** para el Pasaporte de resultado, organizada por jurisdicción, sector y caso de uso, para que Cumplimiento la valide.
> **Estado:** **preparación.** Este documento **no** afirma conformidad con ninguna norma, **no** registra aprobación y **no** compromete plazos. Todos los campos son candidatos **ilustrativos** y quedan **pendientes de validación de Cumplimiento**.

## 1. Punto de partida

El **Pasaporte base** definido en **ADR 0014** continúa vigente y operativo: cada resultado verificable lleva su hoja de vida (quién lo produjo, con qué herramientas, qué aprobaciones hubo, cuánto costó, quién lo verificó, hash y ancla de auditoría). Lo que aquí se prepara son **campos adicionales** que podrían incorporarse según la jurisdicción, el sector o el caso de uso.

Esta matriz **no** afirma que Nexo cumpla ninguna norma. La **conformidad sectorial queda pendiente de validación de Cumplimiento**. Los campos listados son candidatos para su estudio, no requisitos confirmados.

## 2. Cómo leer la matriz

- **Campo candidato:** nombre tentativo del dato adicional que el Pasaporte podría incluir.
- **Jurisdicción/sector/caso de uso:** contexto en el que el campo podría ser pertinente.
- **Motivo:** por qué podría hacer falta (hipótesis a validar, no afirmación).
- **Fuente normativa:** norma concreta si se conoce; en caso contrario, "pendiente".
- **Estado:** siempre "ILUSTRATIVO — pendiente de validación de Cumplimiento" hasta que Cumplimiento se pronuncie.

Los ejemplos están marcados como **ILUSTRATIVOS**. No deben interpretarse como una lista cerrada ni como un compromiso de implementación.

## 3. Matriz de campos candidatos (ejemplos ilustrativos)

| Campo candidato | Jurisdicción / sector / caso de uso | Motivo (hipótesis a validar) | Fuente normativa | Estado |
|---|---|---|---|---|
| `retencionSectorialFinanciera` | Sector financiero | Posible obligación de conservar ciertos resultados por un plazo prolongado. | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `identificadorFiscal` | Transversal / facturación | Trazar un resultado a un contribuyente o documento tributario. | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `consentimientoDatosPersonales` | Datos personales / atención al cliente | Dejar constancia de la base y el momento del consentimiento del titular. | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `baseLegalTratamiento` | Datos personales | Registrar la base legal invocada para el tratamiento asociado al resultado. | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `clasificacionDatos` | Transversal / seguridad | Marcar la sensibilidad del contenido (público, interno, confidencial, reservado). | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `jurisdiccionAplicable` | Multi-país | Indicar bajo qué marco se produjo y debe interpretarse el resultado. | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `selloTiempoTercero` | Evidencia / probatorio | Posible sellado de tiempo por un tercero de confianza (ligado a consulta de Jurídica). | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `politicaEliminacion` | Datos personales / retención | Documentar la regla de eliminación aplicada o pendiente. | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |
| `supervisionHumanaRegistrada` | Sectores regulados / decisiones automatizadas | Dejar constancia de la intervención humana en resultados con impacto. | pendiente | ILUSTRATIVO — pendiente de validación de Cumplimiento |

## 4. Qué pedimos a Cumplimiento

1. Revisar cada campo candidato y marcarlo como: **requerido**, **opcional**, **no aplica** o **requiere más estudio**.
2. Completar la columna **Fuente normativa** donde hoy dice "pendiente".
3. Añadir campos que falten por jurisdicción, sector o caso de uso de interés.
4. Priorizar los campos requeridos para una futura incorporación al Pasaporte (sin que esta priorización constituya compromiso de fecha).

## 5. Lo que esta matriz NO hace

- No afirma cumplimiento de ninguna norma ni certifica conformidad sectorial.
- No convierte un campo candidato en requisito hasta que Cumplimiento lo valide.
- No inventa fuentes normativas: donde no se conocen, dice "pendiente".
- No registra aprobaciones ni plazos.

---

**Estado del documento:** preparación — todos los campos **ILUSTRATIVOS, pendientes de validación de Cumplimiento.** El Pasaporte base (ADR 0014) continúa.
