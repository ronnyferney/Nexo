# Visibilidad y permisos de agentes

## Niveles
- **Personal (PRIVATE)**: solo el dueño. Es el nivel por defecto de todo agente nuevo, incluidos los que crea el Copilot.
- **Equipo (TEAM)**: unidades corporativas (con sus subunidades) y personas con quienes se comparte.
- **Empresa (WORKSPACE)**: todos los miembros. Requiere que el agente esté lanzado.

## Permisos
- **EDIT**: el dueño, los ADMIN/OWNER del workspace y quienes recibieron el agente con permiso de edición.
- **USE** (conversar, usar en flujos, ver la configuración no sensible): lo anterior más quienes lo recibieron para uso,
  todos los miembros si es de empresa y los miembros de las unidades compartidas si es de equipo.
- Los ADMIN/OWNER ven la configuración, el costo y la salud de todos los agentes, pero no el contenido de
  conversaciones ajenas.

## Creación
Cualquier miembro puede crear agentes personales si el workspace lo permite (ajuste "agentes personales"). Crear o
pasar a equipo o empresa requiere rol EDITOR o superior.

## Conversaciones privadas
Cada usuario solo ve sus propias conversaciones con un agente.

## Otras acciones
Transferir la propiedad, duplicar un agente como copia personal y explorar los agentes compartidos contigo.
