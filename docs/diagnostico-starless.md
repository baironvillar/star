# Diagnóstico de Starless

Starless (v0.6.0) es la implementación de referencia: unas 3.000 líneas entre
scripts, workflows y el relay. Esto es lo que se lleva al kit y lo que no.

## Lo que se lleva

Casi todo lo que se lleva es criterio, no código.

**`scripts/version.ts`**

- La versión se edita como texto; el archivo no se vuelve a serializar.
- Al reescribir `Cargo.toml`, se verifica que los encabezados de sección sigan
  iguales. Antes se perdía `[dependencies]` y el error salía en `tauri-build`
  sin relación aparente.
- `Cargo.lock` se actualiza junto con el resto, para que el primer build no
  deje el árbol sucio.
- Antes del bump: manifiestos de acuerdo, rama `release/<v>`, tag libre, notas
  escritas.
- La confirmación distingue tres respuestas: sí, no, y "no hay nadie para
  contestar". Sin terminal exige `--yes`.
- El nivel (patch, minor, major) lo decide una persona, no el diff.

**`scripts/releases.ts`**

- La extracción de la sección del changelog, escrita una sola vez.
- La idea de `check`: verificar la release en borrador antes de publicarla.
- El canal: un tag cuyo commit no llegó a `main` sale como prerelease.

**`.github/workflows/release.yml`**

- El commit etiquetado se tiene que llamar como la versión (GitHub titula la
  corrida con ese asunto).
- El tag tiene que coincidir con la versión.
- Las notas salen del changelog, con `generateReleaseNotes: false`.
- La release queda en borrador.

**`relay/`**

- Ya es casi genérico: la lógica pura (`report.ts`) separada del I/O, límite por
  IP y crashes agrupados por firma.

**Hooks**

- `commit-msg` y `pre-push` son casi idénticos en Starless y flotas.

## Lo que se mejora

- **La llave pública se escribe como texto.** `updater.ts pubkey` vuelve a serializar
  `tauri.conf.json` con `JSON.stringify`: el mismo bug que `version.ts` ya había
  corregido.
- **`updater.ts manifest` sobra:** `tauri-action` ya arma `latest.json`.
- **`releases.ts sync` y `sign.yml` no se llevan.** Son unas 500 líneas que
  reparan releases publicadas con un flujo anterior (nombres con el idioma,
  assets apuntados por id, firmas faltantes). `tauri-action` v1 ya resuelve los
  nombres y sube las firmas.
- **Nada escrito a mano:** el nombre `starless` en el lock, los patrones
  `Starless_*_x64.msi`, las rutas. El kit los detecta.
- **Un solo changelog.** Starless mantiene `CHANGELOG.md` y una copia en
  `src/lib/changelog.ts`. El "qué hay de nuevo" del plugin va a salir del mismo
  changelog.
- **Multiplataforma.** El workflow es sólo Windows, en PowerShell, con las claves
  de `latest.json` fijas para Windows. Con la lógica en el CLI, el YAML queda
  delgado y corre en Windows y Linux.
- **Una fuente de versión menos.** Tauri 2 acepta
  `"version": "../package.json"` en `tauri.conf.json`. `init` lo puede ofrecer.

## Lo que pasa al plugin, no al CLI

- `BUILD_COMMIT` y el canal compilados en el binario (para que una app no se
  ofrezca a sí misma como actualización).
- El envío de crashes y feedback al relay desde la app.
