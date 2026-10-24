# Rotación de claves de cifrado (auditoría B7)

Nexo cifra con AES-256-GCM los valores sensibles que guarda: la bóveda de secretos (`Secret.ciphertext`), las claves y
tokens de los proveedores IA (`LlmConnection.apiKeyCipher`, `oauthRefreshCipher`), los tokens OAuth de los conectores
(`OAuthCredential`), los códigos de dispositivo en curso (`LlmAuthFlow.deviceCodeCipher`) y el `code_verifier` que viaja
dentro del `state` OAuth firmado. El código vive en `apps/api/src/common/crypto/`.

## Formato

| Formato | Aspecto | Clave | AAD |
| --- | --- | --- | --- |
| v2 (vigente) | `v2:<kid>:base64(iv[12] \| tag[16] \| datos)` | la del `kid` | `nexo:v2:<kid>:<contexto>` |
| legacy (antes de B7) | `base64(iv[12] \| tag[16] \| datos)` | `ENCRYPTION_KEY` | ninguna |

- **`kid`**: identifica la clave con la que se cifró el valor; varias claves conviven y se rota sin parar el servicio.
- **Contexto (AAD)**: `CipherContext` (`cipher-context.ts`), con el tipo y el campo, el `workspaceId` y los
  identificadores inmutables de la fila (nombre del secreto, conector, usuario del flujo, `jti` del `state`). Un valor
  copiado a otra fila, a otro campo o a otro workspace no se descifra aunque la clave sea la misma.
- Los valores **legacy** se siguen leyendo sin AAD. Toda escritura nueva usa v2 con la clave activa (también cuando la
  API conserva un refresh token anterior: lo vuelve a cifrar) y `crypto:rotate` convierte el resto.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `ENCRYPTION_KEY` | Clave legacy (32 bytes en hexadecimal), `kid` reservado `k0`. Descifra el formato anterior. |
| `ENCRYPTION_KEYS` | Claves adicionales `kid:hex` separadas por coma: `k2026a:<64 hex>,k2026b:<64 hex>`. `kid`: 1 a 32 caracteres `[A-Za-z0-9_-]`. |
| `ENCRYPTION_ACTIVE_KID` | `kid` con el que se cifra lo nuevo. Obligatorio con más de una clave; puede ser `k0`. |
| `ENCRYPTION_LEGACY_READS` | `false` rechaza los valores sin prefijo. Solo después de rotar todo. |

La API no arranca si una clave no es hexadecimal de 64 caracteres, si hay `kid` repetidos o dos `kid` con la misma clave,
si `ENCRYPTION_ACTIVE_KID` no existe o si falta elegirlo. En producción también rechaza, para **cada** clave, los valores
de ejemplo y las claves de baja entropía (igual que con `ENCRYPTION_KEY`, M9). Ninguna clave puede coincidir con
`JWT_SECRET`.

## Procedimiento de rotación

1. **Generar la clave nueva:** `openssl rand -hex 32`. Guárdela en el gestor de secretos junto a la actual; nunca en el
   repositorio.
2. **Desplegar la clave sin activarla** en todas las réplicas (API y workers):
   `ENCRYPTION_KEYS=k2026b:<hex>` y `ENCRYPTION_ACTIVE_KID=k0` (o el `kid` activo de la rotación anterior). Así, mientras
   el despliegue avanza, ninguna réplica escribe con una clave que otra todavía no conoce.
3. **Activarla:** `ENCRYPTION_ACTIVE_KID=k2026b` y desplegar de nuevo. Desde ese momento todo lo nuevo usa `k2026b`.
4. **Re-cifrar lo existente** desde `apps/api` (o en la imagen de producción `node dist/common/crypto/crypto-rotate.cli.js`,
   con las mismas variables que la API):

   ```bash
   npm run crypto:rotate -- --dry-run          # cuenta lo pendiente (descifra para verificar, no escribe)
   npm run crypto:rotate                       # re-cifra por lotes de 200
   npm run crypto:rotate -- --batch-size=1000  # lotes más grandes
   npm run crypto:rotate -- --workspace=<id>   # solo un workspace (rotación gradual)
   ```

   - Es **idempotente**: solo toca valores que no empiezan por `v2:<kid activo>:`; una segunda ejecución informa 0.
   - Se puede ejecutar con la API en marcha: cada fila se actualiza solo si su texto cifrado no cambió desde que se leyó
     (`reescritos por la API` en el informe significa que la API la reemplazó ya con la clave activa).
   - Si un valor no se descifra (clave ausente o dato dañado) se informa el modelo, el campo y el id, nunca el valor, y
     el comando termina con código 1. Esos valores no se tocan.
   - Toca `updatedAt` de `Secret` y `LlmConnection`; el `state` OAuth no se guarda en la base de datos (vive 10 minutos)
     y no necesita rotación.
5. **Retirar la clave anterior** cuando `--dry-run` informe 0 pendientes:
   - Si era una clave de `ENCRYPTION_KEYS`, quítela de la lista.
   - Si era `ENCRYPTION_KEY` (`k0`), defina `ENCRYPTION_LEGACY_READS=false`, verifique y luego quite `ENCRYPTION_KEY`.
     (El `docker-compose.yml` y el stack del piloto todavía exigen `ENCRYPTION_KEY`: mientras sea así, consérvela.)
   - Conserve una copia de la clave retirada fuera de línea mientras existan copias de seguridad de la base de datos
     cifradas con ella.

Si la clave activa se compromete: genere otra, actívela (pasos 2 y 3), rote (paso 4) y retire la comprometida (paso 5).
Rotar no invalida los tokens OAuth ya emitidos: si la base de datos también pudo filtrarse, revoque las sesiones de los
proveedores y pida a los clientes reemplazar los secretos.

## Agregar un campo cifrado

1. Añada su propósito a `CipherPurpose` y un constructor en `CipherContexts` con datos **inmutables** de la fila.
2. Cifre y descifre siempre con ese contexto.
3. Agréguelo a `rotationTargets()` en `crypto-rotation.ts` (con su prueba): si no, `crypto:rotate` no lo convierte.

## Ruta a KMS (ADR 0008, fase 2)

El formato v2 está pensado para pasar a *envelope encryption* sin cambiar los llamadores de `CryptoService`:

- Un `kid` nuevo (p. ej. `kms1`) identificará una **llave de datos por workspace** (DEK) generada con
  `GenerateDataKey` de AWS KMS y guardada cifrada por la llave maestra (KEK) en una tabla propia (requiere migración).
- `CryptoService` resolverá la clave de un `kid` KMS descifrando la DEK con `kms:Decrypt` (con el `workspaceId` como
  *encryption context* de KMS, el mismo dato que ya va en el AAD) y la mantendrá en memoria un tiempo acotado.
- `crypto:rotate` migrará de `k0`/`ENCRYPTION_KEYS` a `kms1` con el mismo procedimiento; rotar la KEK en KMS no exige
  re-cifrar datos, solo las DEK.
- Las conversaciones (D7, fase 2) usarán la misma DEK por workspace.
