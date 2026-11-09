# Changelog

Los cambios que nota quien usa star en su app. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- `star doctor`: revisa la app y dice qué falta o está mal, y cómo arreglarlo.
  Mira que los manifiestos coincidan, las notas de la versión publicada y la
  sección `## [Sin publicar]`, la puerta, los hooks (instalados, con
  `core.hooksPath` y ejecutables en git), que la tarea `release` de
  `vite.config.ts` no tenga caché, los scripts que llaman a `star` sin `bunx`,
  que la CI corra `star lint`, el remoto, la sesión de `gh` y llaves privadas
  commiteadas. Sale con error si hay algo que haría fallar una release o que
  filtra un secreto; los avisos no frenan.
- `star init changelog`: crea un `CHANGELOG.md` con la sección
  `## [Sin publicar]`, para una app que recién empieza. Si ya hay uno, no lo
  toca.

## [0.2.0] - 2026-11-09

### Agregado

- `star init hooks`: instala los hooks `commit-msg` y `pre-push` en
  `.githooks`, como una línea que llama a star, y apunta git ahí
  (`core.hooksPath`). Si ya había hooks con otro contenido, pregunta antes de
  reemplazarlos, y no toca los demás hooks de la app (como un `pre-commit`).
  Los deja en el stage como ejecutables, también desde Windows, donde además
  apaga `core.filemode` si está prendido (si no, el siguiente `git add -A`
  los devuelve a 644).
- Los hooks revisan la convención: el asunto de un commit es
  `tipo(scope): asunto` (en minúscula, sin punto, hasta 72 caracteres) o la
  versión sola; una rama es `tipo/descripcion-corta` o `release/<versión>`, y
  no se empuja directo a `main` ni a la base.
- `star lint commits [base..head]` y `star lint branch <rama> [--into <base>]`:
  la misma regla para la CI, que no depende de que alguien haya instalado los
  hooks.

## [0.1.0] - 2026-11-08

### Agregado

- `star version`: muestra la versión de cada manifiesto y falla si alguno
  discrepa. Detecta solo el `package.json` raíz, los workspaces, y en una app de
  escritorio `tauri.conf.json`, `Cargo.toml` y `Cargo.lock`.
- `star version bump [patch|minor|major]`: sube la versión en todos los
  manifiestos, cambiando sólo el número. Antes revisa que coincidan, que la rama
  sea `release/<versión>`, que el tag esté libre (también en `origin`) y que
  `CHANGELOG.md` tenga las notas, y pregunta.
- `star version set <x.y.z>`: fija una versión, para reparar manifiestos que
  se desincronizaron.
- `star version tag <tag>`: falla si el tag no coincide con la versión. Es para
  la CI.
- `star notes [versión]`: imprime las notas de una versión desde
  `CHANGELOG.md`.
- `star release [patch|minor|major]`: prepara una versión desde `develop`.
  Revisa que todo esté en orden, corre la puerta (`vp check` y `vp test` por
  defecto, o lo que diga `"star": { "gate" }`), crea `release/<versión>`, sube
  la versión, commitea, empuja y abre el PR. Si las notas están en
  `## [Sin publicar]`, propone convertirlas en la sección de la versión.
- `star release finish`: cuando el CI del PR pasa, lo mergea con squash con la
  versión como asunto, actualiza `develop`, verifica lo que llegó y empuja el
  tag.
