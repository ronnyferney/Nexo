# Guía de pruebas funcionales — NEXO (organización de empleados digitales)

> Para el equipo que validará NEXO manualmente. Explica cómo levantar una versión estable, con qué datos sembrarla y
> qué recorrer en cada módulo, con el resultado esperado. Todo lo aquí descrito está cubierto además por pruebas
> automáticas (unitarias, integración y E2E de navegador), de modo que esta guía valida la experiencia, no la lógica.

## 1. Levantar el entorno de pruebas

Requisitos: Node 22, Postgres y Redis. En el contenedor de desarrollo:

```bash
# Infraestructura
pg_ctlcluster 16 main start           # Postgres :5432
redis-server --port 6379 --daemonize yes

# API (apps/api) — entorno de pruebas (proveedor LLM mock, registro abierto, red privada permitida)
cd apps/api
export DATABASE_URL="postgresql://nexo:nexo@localhost:5432/nexo?schema=public" \
  REDIS_HOST=localhost REDIS_PORT=6379 \
  JWT_SECRET="e2e-jwt-secret-0123456789abcdef0123456789abcdef" \
  ENCRYPTION_KEY="0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff" \
  CONNECTOR_ALLOW_PRIVATE_NETWORKS=true REGISTRATION_MODE=open \
  ANTHROPIC_API_KEY="" LLM_DEV_SIMULATOR=false PORT=3000
npx prisma migrate deploy        # aplica las migraciones a la BD
node dist/main.js                # requiere `npm run build` previo; sirve en http://localhost:3000/api

# Web (apps/web)
cd apps/web && npm start         # http://localhost:4200 (proxy /api -> :3000)
```

> Nota: el proveedor LLM es **mock determinista** (sin clave). El chat del agente responde de forma simulada; las
> pruebas funcionales de gobierno, estructura, resultados y auditoría **no dependen del LLM**. Para probar el chat con
> un modelo real hace falta configurar `ANTHROPIC_API_KEY` (no incluida en el entorno de pruebas).

## 2. Datos mínimos para empezar

1. **Registre un usuario** en `/register` (Nombre, Empresa/espacio, Correo, Contraseña). El **primer usuario del
   espacio es OWNER** (nivel administrador): podrá ver todas las secciones, incluidas las de Dirección y Administración.
2. Opcional: invite a más personas (Configuración → usuarios) y asígneles rol VIEWER/EDITOR/ADMIN para probar permisos.
3. Opcional: cree un **cargo** (Cargos) y un **agente** (Agentes → nuevo) para los recorridos que involucran empleados
   digitales.

## 3. Recorridos por módulo (qué probar y qué esperar)

### Estructura y dimensiones (Administración → Estructura / Dimensiones)
- Cree una **empresa**, un **área** y, si aplica, líneas/sedes/centros de costo. → Aparecen en el árbol de estructura.
- Cree una **dimensión propia** (p. ej. "Proyecto") con valores. → Aparece en el catálogo y sirve para pivotar el consumo.

### Empleado digital (Agentes)
- Cree un agente desde un cargo; asígnele **responsable titular y suplente**. → No se puede publicar sin responsable.
- Pestaña **Ejecución**: asigne una **estación virtual** (créela antes en Administración → Estaciones virtuales) y
  active/desactive **salida a internet**; guarde. → El botón "Guardar" se deshabilita tras guardar (sin cambios pendientes).

### Jerarquía / Organigrama (Agentes → Organigrama)
- Vea el **árbol** de empleados digitales. Como admin, **reasigne el supervisor** de un agente. → Se rechaza con mensaje
  claro si crea un ciclo o si el nivel del supervisor es menor que el del subordinado. "Ver cadena de mando" muestra la
  línea ascendente.

### Trabajo por resultados (Mi trabajo)
- Cree un **objetivo** y una **tarea** con **criterio de aceptación** y entregable. → Aparece en "Mi trabajo".
- Flujo esperado: resultado generado → **verificado** (verificador ≠ ejecutor) → **aceptado o devuelto** con motivo.
  Un correo enviado no cuenta como recaudo: solo cuenta el **contrato de resultado ACEPTADO**.

### Comunicación y handoff (Mensajes / Canales)
- Cree un canal, abra un hilo y **conviértalo en una tarea autorizada** con criterio de aceptación. → El hilo queda
  ligado a la tarea ("Ver tarea") y la tarea aparece en "Mi trabajo".
- Handoff: un agente llega a un punto y otro continúa (contrato de transferencia a nivel de tarea).

### Gobierno (Gobierno → Políticas / Aprobaciones / Suspensión)
- Defina una **política** que exija aprobación para una acción; dispárela y **apruebe/rechace** en la bandeja. → La
  aprobación queda ligada a la acción exacta; un cambio relevante la invalida.
- **Suspenda** un agente/proceso/conector/organización con un clic y verifique que se detiene.

### Pasaporte de resultado (detalle de un resultado ACEPTADO)
- En un contrato **ACEPTADO**, emita el **Pasaporte**. → Muestra la hoja de vida (quién, con qué, aprobaciones, costo,
  verificación) + huella (hash) y ancla de auditoría.
- Pulse **Verificar** → "Cadena íntegra" (verde). **Exporte** el JSON para un auditor externo.

### Cuadrillas (Agentes → Cuadrillas)
- Cree una **plantilla** (ADMIN) → agregue una **versión** con un miembro (el editor es **solo declarativo**: sin
  campos de código/hooks) → **publique** → **instancie**. → El diálogo muestra los **permisos pendientes** y avisa que
  instanciar **no concede acceso** (los agentes quedan en borrador).

### Consola gerencial (Dirección → Consola gerencial) — solo admin
- Elija un período y aplique. → Se cargan Resultados, Economía, Estado de gobierno (aprobaciones/suspensiones/
  excepciones) e **Integridad** con el sello "Cadena íntegra ✓". Donde no hay datos, lo dice (no muestra 0 engañoso).

### Auditoría (Gobierno → Auditoría) — solo admin
- Vea el **sello de integridad** y la lista de hechos de gobierno; filtre por acción/fechas; **expanda una fila** para
  ver los hashes (prueba del encadenamiento). → Alterar un registro rompería la cadena y el sello pasaría a rojo.

### Excepciones (Excepciones)
- Provoque un bloqueo y recupérelo desde la bandeja de **Excepciones**.

### Costos (Costos / Mi consumo / Imputación)
- Revise el **consumo** y la **imputación** por empresa/línea/área/centro; **costo por resultado** en indicadores.

## 4. Pruebas de permisos (multi-tenant y roles)
- Con un usuario **VIEWER**: ve el muro/organigrama/paneles de lectura, pero **no** puede gobernar ni ver Dirección.
- Con **dos espacios distintos**: uno **no** ve datos del otro (aislamiento). Verifíquelo con un dato creado en cada uno.

## 5. Qué NO está activo en este entorno (y por qué)
- **Canales externos (E14)**: correo/WhatsApp/voz — pendientes de decisión de proveedores; se prueban en **sandbox con
  simuladores**, sin envíos reales.
- **Chat con LLM real**: requiere `ANTHROPIC_API_KEY`; el entorno usa el mock determinista.
- **Montos de acciones sensibles**: los umbrales los define Finanzas; el mecanismo de aprobación sí funciona.

## 6. Cómo reportar un hallazgo
Para cada hallazgo indique: módulo y ruta, pasos exactos, resultado esperado vs. obtenido, rol/usuario y espacio, y una
captura si aplica. Eso permite reproducirlo y convertirlo en una prueba automática que evite su regreso.
