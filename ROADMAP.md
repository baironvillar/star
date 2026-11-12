# Roadmap

Cada paso termina con la pieza usada por una app real. Ninguno empieza antes de
que el anterior esté en uso.

**Dónde vamos:** la fase 1 está hecha y la usa flotas. De la fase 2 falta
cerrar el paso 9: Starless ya publica con star, pero sólo betas.

## Fase 1: núcleo, consumido por flotas (hecha)

0. ✅ **Decisiones que bloqueaban** el trabajo de [`docs/alcance.md`](docs/alcance.md).
   Ya comprobado: `vp run` le entrega un TTY a una tarea sin caché (ver
   [`docs/arquitectura.md`](docs/arquitectura.md#el-comando-release)). Las
   preguntas que siguen abiertas no frenan ningún paso.
1. ✅ **Versiones** (v0.1.0). Repo con Vite+ y Bun, adaptadores de manifiestos y
   `star version get|bump|set|tag` y `star notes`, con tests. flotas
   reemplaza su `scripts/version.ts`.
2. ✅ **`release`** (v0.1.0). En dos fases: `star release <nivel>` (chequeos,
   puerta, rama, bump, commit, push y PR) y `star release finish` (squash con
   el asunto exacto, tag y push). Las tareas `verify` y `release` en el
   `vite.config.ts` de flotas.
3. ✅ **Hooks** (v0.2.0). `commit-msg` y `pre-push` en el kit; `star init hooks`
   los instala, y `star lint` corre las mismas reglas en la CI. flotas borra
   su copia.
4. ✅ **`doctor`** (v0.3.0).
5. ✅ **`verify.yml` y target `web`** (v0.3.0). `star verify`, `verify.yml` y
   `web-release.yml`. flotas reemplaza la parte común de su `release.yml` y
   deja sólo lo propio (Docker, empaquetado de la web).

## Fase 2: escritorio, consumido por Starless

6. ✅ **`tauri-release.yml`** (v0.4.0) con `tauri-action` v1 en Windows y Linux,
   y la verificación de `latest.json` (`star release check`).
7. ✅ **`init` del updater** (v0.4.0): llaves, secretos y llave pública, con el
   respaldo de la llave fuera del repo.
8. ✅ **Plantilla del relay** y `star init relay` (v0.4.0).
9. 🔶 **Migrar Starless** y borrar sus scripts. Hecho: Starless publica con
   `verify.yml` y `tauri-release.yml`, sin scripts de release propios, y las
   betas salen como prerelease. Falta: **publicar una versión
   estable** de punta a punta con star y ver que una app instalada se
   actualice desde la anterior.

Entre medio salieron piezas que pidió el uso real: las betas
(`star release --beta`, v0.4.0) y `star init github`, que hace que el squash
de un PR salga de su título y descripción (v0.6.0).

## Fase 3

10. **Plugin de Tauri** (crate + paquete npm): actualizaciones, "qué hay de
    nuevo", crashes y feedback.
11. **macOS:** firma y notarización.
12. **Publicar** en npm con `vp pack`, si después de dos o tres apps quedó pulido.
