# Changelog

Los cambios que nota quien usa star en su app. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Cambiado

- `star init github` deja el repo en GitHub listo para el primer PR con un solo
  comando: en un repo vacío crea el commit inicial y las ramas `main` y base sin
  saltarse el hook, deja la base como rama por defecto, escribe el workflow que
  revisa el título y la plantilla de PR, y deja sólo squash, desde el título y
  la descripción del PR. En sme, el primer PR salió sin nada de eso y el botón
  de merge ofrecía "Merge pull request #1 from…".
- `star release finish` lleva cada versión estable a `main` con un merge commit
  que se llama como ella, antes de crear el tag. `main` ya no recibe pull
  requests, y `star lint branch --into main` los rechaza.
- `star doctor` revisa que exista `main`, que el repo sólo permita squash, que
  la base sea la rama por defecto y que haya plantilla de PR; todo lo que falte
  apunta a `bunx star init github`.

## [0.6.0] - 2026-11-11

### Agregado

- `star init github`: ajusta el repo en GitHub para que el squash de un PR salga
  de su título y su descripción, tenga uno o varios commits. Con lo que GitHub
  trae por defecto, un PR con varios commits dejaba el mensaje por escribir a
  mano. Muestra el cambio y pregunta antes.
- `star lint title <título>`: revisa en la CI que el título del PR cumpla la
  convención, porque con esos ajustes es el asunto del commit que llega a la
  base.
- `star doctor` avisa si el repo no arma el squash desde el PR, o si la CI no
  revisa el título.

## [0.5.1] - 2026-11-11

### Corregido

- `tauri-release.yml` ya no falla antes de compilar cuando `build-env` se escribe
  con `|`: la línea vacía del final hacía salir con error el paso que copia las
  variables.
- `tauri-release.yml` le da al MSI de una beta una versión numérica
  (`0.7.0-beta.1` → `0.7.0.1`): WiX rechaza el sufijo y el empaquetado fallaba
  después de compilar. La versión de la app, del tag y de `latest.json` no
  cambia.
- El último job de `tauri-release.yml` ya ve la release en borrador: con
  `contents: read`, `star release check` decía "release not found".

## [0.5.0] - 2026-11-10

### Agregado

- `"star": { "lint": { "since": "<commit>", "skip": ["<commit>"] } }`: la
  historia que `star lint commits` no revisa, para una app que adopta la
  convención con commits viejos que no la cumplen. `since` saca ese commit y
  sus ancestros; `skip`, commits sueltos.
- `verify.yml` devuelve `commit`: el sha del commit etiquetado, para la app que
  lo compila adentro.

### Cambiado

- `star lint branch <rama> --into <base>` rechaza un pull request que no va a
  la base (ni de la base a `main`). Un PR encima de otro se mergea en la rama
  del otro y, si el de abajo ya entró, el cambio no llega nunca a la base.

## [0.4.0] - 2026-11-10

### Agregado

- `star init relay`: copia a `relay/` el relay de reportes, un Cloudflare
  Worker que convierte los reportes de crash y el feedback de la app en issues
  de GitHub. Guarda el token del lado del servidor, limita por dirección y
  agrupa los crashes repetidos. Llena el nombre de la app y el repo, y no pisa
  un `relay/` que ya existe. Los pasos para ponerlo en marcha están en el README
  que copia.

### Agregado

- `star init updater`: para una app de Tauri, genera la llave del updater (sin
  contraseña) con un respaldo en `~/.star/keys/<identifier>/`, la sube como
  secreto `TAURI_SIGNING_PRIVATE_KEY` y escribe la llave pública en
  `tauri.conf.json`. La llave no aparece nunca en pantalla ni en la línea de
  comandos. Si la app ya tiene llave, no genera otra: revisa que esté todo, sube
  el respaldo si falta el secreto, y con `--import <ruta>` trae una llave que ya
  existía.
- `star doctor` revisa el updater de una app de escritorio: la llave pública,
  el secreto (sólo su nombre), el respaldo y `createUpdaterArtifacts`.

### Agregado

- Workflow reutilizable `tauri-release.yml` para apps de escritorio con
  Tauri 2: crea la release en borrador con las notas del CHANGELOG, compila y
  firma con `tauri-action` v1 en Windows y Linux, y revisa `latest.json`. macOS
  todavía no.
- `star release check <tag> [--platforms windows,linux]`: revisa que
  `latest.json` tenga cada plataforma, que apunte a archivos de la release, que
  cada firma sea la de su `.sig` y que las notas sean las del CHANGELOG.
- `verify.yml` acepta `runs-on` y `rust`, para la puerta de una app de
  escritorio que corre `cargo test`, y devuelve `prerelease`.
- Betas: `star release minor --beta` saca la `0.7.0-beta.1`, `star release
  beta` la siguiente, y `star release minor` la versión final. Una beta copia
  las notas de `## [Sin publicar]` sin sacarlas de ahí, para que la versión
  final salga con todas. `web-release.yml` y `tauri-release.yml` publican una
  versión con sufijo como prerelease, que la app instalada no ve.

## [0.3.0] - 2026-11-09

### Agregado

- `star verify <tag>`: todo lo que se revisa antes de construir un tag. El
  commit se llama como la versión, el tag coincide con los manifiestos, hay
  notas y pasa la puerta. Con `--notes-file` escribe las notas, y en GitHub
  Actions deja `version` como output.
- Workflow reutilizable `verify.yml`: corre `star verify` en el tag y sube las
  notas como artefacto.
- Workflow reutilizable `web-release.yml`: crea la release en borrador con las
  notas y los artefactos que la app construyó, y revisa que haya quedado en
  borrador, en el tag correcto y con todos los archivos.
- `star doctor` avisa si los workflows de star que usa la app son de otra
  versión que la instalada.

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
