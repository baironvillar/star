# Arquitectura

Propuesta, no implementada. Cambia con lo que se decida en
[`alcance.md`](alcance.md).

## Estructura del repo

```
star/
  package.json          el CLI vive en la raíz (ver "Instalación")
  src/
    cli.ts              init | release | doctor | version | notes | verify
    manifests/          un adaptador por tipo de manifiesto
      package-json.ts   package.json raíz + workspaces
      tauri-conf.ts     src-tauri/tauri.conf.json
      cargo.ts          Cargo.toml [package] y su entrada en Cargo.lock
    changelog.ts        la sección de una versión, escrita una sola vez
    git.ts              preguntas a git: rama, tags, árbol limpio
    gh.ts               gh: secretos (sólo nombres al leer), releases
    targets/
      web.ts            release en borrador + verificación
      tauri.ts          updater, verificación de latest.json
    conventions.ts      la regla de commits y ramas, para los hooks y la CI
    hooks.ts            star init hooks y star lint commits
  .github/workflows/
    verify.yml          reutilizable: chequeos comunes a cualquier app
    web-release.yml     reutilizable: release en borrador para una app web
    tauri-release.yml   reutilizable: tauri-action en Windows y Linux
    ci.yml              el CI del propio kit
  templates/
    relay/              el Worker de Cloudflare, parametrizado
  vite.config.ts        vp check / vp test del kit
  (más adelante)
  crates/tauri-plugin-star/
  packages/plugin-js/
```

## Piezas

### Versiones

La versión vive en un solo lugar y se copia al resto. Los adaptadores saben
leer y escribir el número en cada formato **como texto**: no se vuelve a
serializar el archivo, porque eso lo reformatea y rompe el lint en cada bump (le
pasó a Starless dos veces).

- `package.json`: el campo `version`, en la raíz y en cada workspace.
- `tauri.conf.json`: el campo `version`. Si apunta a `../package.json` (Tauri 2
  lo permite), no se escribe: ya hay una fuente menos.
- `Cargo.toml`: la versión del bloque `[package]`, nunca la de una dependencia,
  y se verifica que los encabezados de sección sigan iguales después de
  escribir.
- `Cargo.lock`: la entrada del paquete, buscada por el nombre que dice
  `Cargo.toml`, no escrito a mano.

La app se detecta sola: si hay `src-tauri/`, es escritorio; si no, web.

### El comando `release`

Son dos fases, porque el bump vuelve a `develop` por un pull request como
cualquier cambio, y se mergea con squash: el commit que llega a `develop` no es
el de la rama, y el tag tiene que ir sobre el que llegó.

```bash
vp run release minor     # desde develop
vp run release finish    # cuando el CI del PR pasa
```

Para una beta, `vp run release minor --beta` (`0.7.0-beta.1`) y después
`vp run release beta` (`0.7.0-beta.2`). `vp run release minor` saca la `0.7.0`.
Ver la decisión 16.

**`star release <nivel>`**, desde `develop`:

1. Chequea: estar en `develop` al día con `origin` y sin commits propios, sin
   cambios fuera del `CHANGELOG.md`, manifiestos de acuerdo, tag libre (local y
   en `origin`), la rama `release/<versión>` libre y las notas escritas.
2. Si no hay sección `## [x.y.z]` pero sí algo en `## [Sin publicar]`, propone
   convertirlo en la sección de la versión, con la fecha de hoy, como se hacía a
   mano.
3. Corre la puerta. Va después de los chequeos baratos: no tiene sentido esperar
   los tests de una versión que igual no puede salir.
4. Muestra el cambio y las notas, y pregunta. Sin terminal no adivina: exige
   `--yes`.
5. Crea `release/<versión>`, escribe la versión, commitea `x.y.z`, empuja y abre
   el PR a `develop` con las notas como cuerpo (si `gh` tiene sesión).

**`star release finish`**, desde la rama de la versión o desde `develop`:

1. Busca el PR. Frena si el CI falló o todavía corre, o si tiene conflictos.
2. Pregunta, y lo mergea con squash usando la versión como asunto, sin el
   número del PR. Mergeado a mano, GitHub lo agrega, y el workflow de release
   rechaza ese commit porque GitHub titula la corrida del tag con su asunto.
3. Actualiza `develop` y verifica lo que llegó: el asunto, la versión y las
   notas.
4. Crea el tag anotado `vx.y.z` y lo empuja. Desde ahí sigue la CI.

**Con `"star": { "autoMerge": true }`** las dos fases corren seguidas: después
de abrir el PR, `star release` le pregunta a GitHub por el CI cada 15 segundos
y, cuando pasa, hace el `finish` sin volver a preguntar (la pregunta de
preparar ya lo decía). Si el CI falla, se para sin mergear; si sigue corriendo
después de 30 minutos, o se corta con Ctrl+C, `star release finish` retoma, y
con `autoMerge` también espera en vez de fallar. Ver la decisión 22.

**La puerta** sale de `"star": { "gate": ... }` en el `package.json` de la app.
Sin configurar, si la app usa Vite+ es `vp check` y `vp test run`. En una app
con Vite+ conviene apuntarla a una tarea cacheada (`"gate": "vp run verify"`):
probado con Vite+ 1.5.0, un `vp run` anidado dentro de la tarea `release`
funciona, y si nada cambió desde el último check sale de la caché. La tarea
`release` no necesita `dependsOn`: star corre la puerta él mismo, así que
tampoco se la salta quien llame `bunx star release` directo.

**La tarea `release` tiene que ser `cache: false`.** Probado con Vite+ 1.5.0 en
Windows: una tarea cacheada corre sin TTY (`stdin.isTTY` y `stdout.isTTY` son
`false`) y `prompt()` devuelve `null` al instante, así que la pregunta del paso
3 se leería como "no hay nadie para contestar". Con `cache: false` la tarea
recibe la terminal real, aunque dependa de una tarea cacheada: `verify` se
reproduce desde la caché ("cache hit, replaying") y `release` igual puede
preguntar. Los argumentos que siguen al nombre (`minor`) llegan al comando.
`doctor` revisa que la tarea `release` de la app no tenga caché.

### Hooks de git

La convención de commits y ramas vive en `src/conventions.ts`, y la corren dos
comandos: `star hook <nombre>` desde el hook de git y `star lint` desde la CI.
Lo que pasa en local no falla en el PR, porque es el mismo código.

En la app queda una línea por hook, que `star init hooks` escribe en
`.githooks` y que se commitea:

```sh
#!/usr/bin/env sh
exec bunx star hook commit-msg "$@"
```

- **No se copia el script.** flotas y Starless tenían cada uno su `commit-msg`
  en `sh`, y las copias ya diferían. Con una línea que llama a star, una
  corrección llega a todas las apps al subir la versión.
- **`core.hooksPath` apunta a la carpeta de la app**, no a `node_modules`: la
  app puede tener sus propios hooks al lado (flotas tiene un `pre-commit` con
  `vp staged`), y los hooks quedan en el repo donde se ven.
- **Se ponen en el stage como ejecutables** (`git add --chmod=+x`). Windows no
  guarda el bit en el disco; sin esto llegan al índice como 644, y en un clon
  de Linux o macOS git los ignora con un aviso. En Windows, además, se apaga
  `core.filemode` si está prendido: con el disco sin el bit, git vería los
  hooks cambiados a 644 y un `git add -A` desharía el `--chmod`.
- **El título del PR es un asunto más.** Con los ajustes que pone
  `star init github` (decisión 18), GitHub arma el squash con el título y la
  descripción del PR, así que `star lint title` revisa el título en la CI, en
  un workflow con `pull_request: types: [opened, edited, synchronize,
  reopened]`: un título se puede cambiar sin empujar nada. `init github`
  escribe ese workflow y la plantilla de PR desde `templates/github/`.
- **El repo sólo permite squash** (decisión 19). `main` no recibe PRs: la
  actualiza `star release finish` con un merge commit que se llama como la
  versión, y lo empuja con `--no-verify`, porque el hook `pre-push` está para
  frenar a las personas. Es, con el arranque de un repo vacío (decisión 20),
  el único push a `main` que hace star.
- **Una app con historia** le dice a `star lint commits` desde dónde rige la
  regla (`"star": { "lint": { "since", "skip" } }`), y lo de antes no se revisa
  (decisión 14).
- **La regla no es configurable todavía.** Los tipos, el largo y las ramas
  protegidas son los de flotas y Starless. La base protegida sale de
  `"star": { "base" }`. Ver la pregunta abierta en [`alcance.md`](alcance.md).

### `doctor`

`star doctor` corre una lista de chequeos y marca cada uno como ✓, aviso (!) o
problema (✗), con el comando que lo arregla. Sale con error sólo si hay un
problema: algo que haría fallar `release` o la CI, o un secreto commiteado.

- **Lee, no ejecuta.** `vite.config.ts` se lee como texto para encontrar la
  tarea `release`: importarlo correría código de la app solo para diagnosticarla.
- **Las notas se exigen a la versión con tag.** La versión inicial de una app
  que nunca publicó no tiene nada que contar.
- **Llaves privadas:** `git grep` sobre lo commiteado, buscando PEM y la llave
  del updater de Tauri. Una llave que llegó a git ya se filtró: el arreglo es
  rotarla, no borrarla.
- **Secretos de GitHub (sólo nombres) y el updater** entran con el target
  `tauri`, en la fase 2.

### Workflows reutilizables

```
tag v* ──► verify.yml ──► web-release.yml    (app web: + jobs propios, p. ej. Docker)
                      └─► tauri-release.yml  (app de escritorio)
```

- **`verify.yml`:** corre `star verify` en el tag: el commit se llama como la
  versión, el tag coincide con los manifiestos, existen las notas, pasa la
  puerta. Devuelve `version` y sube las notas como artefacto.
- **`tauri-release.yml`:** tres jobs.
  1. `draft` crea la release en borrador una sola vez, con las notas del
     CHANGELOG. Si cada plataforma de la matriz la creara, competirían.
  2. `build` es una matriz (Windows en `windows-latest`, Linux en
     `ubuntu-22.04` por la glibc del AppImage) con `tauri-action` v1. Compila,
     firma, sube instaladores y `.sig`, y agrega su plataforma a `latest.json`.
  3. `check` corre `star release check`: cada plataforma pedida está en
     `latest.json`, apunta a un archivo de la release, su firma es la del `.sig`
     y las notas son las del CHANGELOG.

  Una beta en Windows le pasa a Tauri `bundle.windows.wix.version` con la beta
  como cuarto campo (`0.7.0-beta.1` → `0.7.0.1`), porque WiX sólo acepta
  versiones numéricas. El job `check` tiene `contents: write` aunque sólo lee:
  con `read` no ve los borradores.

  macOS se rechaza con un error que dice por qué. Una versión con sufijo
  (`0.7.0-beta.1`) sale como prerelease (decisión 16). Lo propio de la app
  (variables de la build, `--config`) entra por `build-env` y `args`.

- **`web-release.yml`:** crea la release en borrador con las notas y los assets
  que la app subió como artefactos del workflow, y revisa que haya quedado en
  borrador, en el tag correcto y con todos los archivos. No hace checkout ni
  instala nada: sólo llama a `gh`.

La lógica vive en el CLI, no en el YAML: los workflows llaman a `star verify`
y similares. Así el YAML queda delgado, sirve igual en Windows y Linux, y la
misma regla corre en local y en la CI. El workflow usa el star **instalado en
la app** (ver la decisión 15), y `doctor` avisa si la versión del workflow
(`@v0.3.0`) y la instalada no coinciden.

star se publica con estos mismos workflows (`.github/workflows/release.yml`),
así que cada versión del kit los prueba en GitHub.

### Updater (escritorio)

`star init updater` decide qué hacer según lo que ya hay, y nunca genera una
llave para una app que ya tiene una: la pública va adentro de cada instalador
publicado, y una llave nueva los deja sin actualizaciones.

| La app tiene                             | Qué hace                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `"pubkey": ""` y nada en el respaldo     | genera la llave en `~/.star/keys/<identifier>/`, la sube como `TAURI_SIGNING_PRIVATE_KEY` y escribe la pública |
| la pública y el respaldo, sin el secreto | sube el respaldo como secreto                                                                                  |
| la pública y el secreto, sin respaldo    | avisa; `--import <ruta>` copia una llave existente si su `.pub` es la de la app                                |
| un respaldo que no es de esta pública    | no toca nada                                                                                                   |

- **Sin contraseña** (decisión 17): `tauri signer generate` sólo la acepta por
  `-p`, en argv. La llave se protege por dónde vive.
- La llave va a `gh secret set` **por stdin**. No aparece en argv, en pantalla
  ni en un log; la salida de `tauri signer` se captura.
- La pública se escribe en `plugins.updater.pubkey` como texto
  (`findStringAt`), sin reformatear `tauri.conf.json`.
- `doctor` revisa lo mismo, más `bundle.createUpdaterArtifacts`. De los
  secretos lee sólo los nombres.

### Relay (escritorio)

El Worker de Starless, en `templates/relay/`. `star init relay` lo copia a
`relay/` en la app con el nombre (`APP`) y el repo (`REPO`) en
`wrangler.toml`. Cada app lo despliega en su propia cuenta de Cloudflare, y el
token de GitHub vive como secreto del Worker, nunca en la app ni en un archivo.

- **El código es el mismo de Starless.** Lo único propio era el nombre en el
  User-Agent y en las marcas de cada issue (`<!-- starless-relay -->`). Ahora
  sale de `APP`, y con `APP = "starless"` las marcas de los issues existentes
  siguen siendo las mismas.
- **No pisa un `relay/` que ya existe** (decisión 14). Starless tiene el suyo,
  con el id de su almacenamiento ya commiteado.
- **star no crea la cuenta de Cloudflare ni el token.** Los pasos están en el
  README que se copia, y el token va directo a Cloudflare con
  `wrangler secret put`.
- Los tests de la plantilla son de `bun test`, como los va a correr la app, y
  el CI de star los corre (`bun test templates`).

## Instalación en una app

```bash
bun add -d github:baironvillar/star#v0.1.0
```

- **El CLI vive en la raíz del repo** porque Bun no instala un subdirectorio de
  un repo git. Las demás piezas (plugin, plantillas) van como carpetas o
  workspaces.
- **Bun ejecuta el TypeScript directo**, así que una dependencia git funciona sin
  paso de build. `vp pack` entra cuando se publique en npm y el CLI tenga que
  correr también con Node.
- **Los scripts y las tareas llaman a `bunx star`, no a `star`.** En Windows, el
  shim que Bun crea para un bin con shebang `bun` busca `bun.exe` en el PATH, y
  falla donde Bun se instaló con npm (que deja un `bun.cmd`). `bunx` funciona en
  los dos casos. Pasó al adoptarlo en flotas.
- La configuración, si hace falta, va en la clave `"star"` del `package.json`
  de la app. No en `vite.config.ts`: Vite+ valida sus propias claves.
