# Roadmap

Cada paso termina con la pieza usada por una app real. Ninguno empieza antes de
que el anterior esté en uso.

## Fase 1: núcleo, consumido por flotas

0. **Decisiones pendientes** de [`docs/alcance.md`](docs/alcance.md), y
   comprobar que `vp run` le entrega un TTY a una tarea.
1. **Versiones.** Repo con Vite+ y Bun, adaptadores de manifiestos y
   `star version get|bump|set|tag` y `star notes`, con tests. flotas
   reemplaza su `scripts/version.ts`.
2. **`release`.** Puerta, chequeos, bump, commit, tag y push. Las tareas
   `verify` y `release` en el `vite.config.ts` de flotas.
3. **Hooks.** `commit-msg` y `pre-push` en el kit; `star init hooks` los
   instala. flotas borra su copia.
4. **`doctor`.**
5. **`verify.yml` y target `web`.** flotas reemplaza la parte común de su
   `release.yml` y deja sólo lo propio (Docker, empaquetado de la web).

## Fase 2: escritorio, consumido por Starless

6. **`tauri-release.yml`** con `tauri-action` v1 en Windows y Linux, y la
   verificación de `latest.json`.
7. **`init` del updater:** llaves, secretos y llave pública.
8. **Plantilla del relay** y `star init relay`.
9. **Migrar Starless** y borrar sus scripts.

## Fase 3

10. **Plugin de Tauri** (crate + paquete npm): actualizaciones, "qué hay de
    nuevo", crashes y feedback.
11. **macOS:** firma y notarización.
12. **Publicar** en npm con `vp pack`, si después de dos o tres apps quedó pulido.
