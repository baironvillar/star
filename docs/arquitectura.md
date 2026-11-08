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
  hooks/
    commit-msg          sh, el mismo archivo para el hook y la CI
    pre-push
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

```bash
vp run release minor
```

1. Corre la puerta (por defecto la tarea `verify`: `vp check` y `vp test`).
   Como es una tarea cacheada de Vite+, si nada cambió desde el último check
   pasa al instante.
2. Chequea: manifiestos de acuerdo, rama `release/<versión>`, tag libre,
   sección del changelog escrita, árbol limpio en los manifiestos.
3. Muestra el cambio y pregunta. Sin terminal no adivina: exige `--yes`.
4. Escribe la versión, crea el commit `x.y.z` y el tag `vx.y.z`, y empuja.

**La tarea `release` tiene que ser `cache: false`.** Probado con Vite+ 1.5.0 en
Windows: una tarea cacheada corre sin TTY (`stdin.isTTY` y `stdout.isTTY` son
`false`) y `prompt()` devuelve `null` al instante, así que la pregunta del paso
3 se leería como "no hay nadie para contestar". Con `cache: false` la tarea
recibe la terminal real, aunque dependa de una tarea cacheada: `verify` se
reproduce desde la caché ("cache hit, replaying") y `release` igual puede
preguntar. Los argumentos que siguen al nombre (`minor`) llegan al comando.
`doctor` revisa que la tarea `release` de la app no tenga caché.

### Workflows reutilizables

```
tag v* ──► verify.yml ──► web-release.yml    (app web: + jobs propios, p. ej. Docker)
                      └─► tauri-release.yml  (app de escritorio)
```

- **`verify.yml`:** el commit del tag se llama como la versión, el tag coincide
  con los manifiestos, existen las notas, pasa la puerta.
- **`tauri-release.yml`:** matriz Windows y Linux con `tauri-action` v1, que
  compila, firma, crea la release y junta las plataformas en `latest.json`.
  Después, un job verifica la release en borrador.
- **`web-release.yml`:** crea la release en borrador con las notas y los assets
  que la app subió como artefactos del workflow.

La lógica vive en el CLI, no en el YAML: los workflows llaman a `star verify`
y similares. Así el YAML queda delgado, sirve igual en Windows y Linux, y la
misma regla corre en local y en la CI. El workflow obtiene el CLI en la misma
versión que él (`job_workflow_sha`).

### Updater (escritorio)

`star init` genera las llaves con `tauri signer generate`, con una
contraseña aleatoria creada dentro del proceso, y las pasa por stdin a
`gh secret set`. Ni la llave ni la contraseña aparecen en argv, en pantalla ni
en un log. La llave pública se escribe en `tauri.conf.json` como texto. Ver la
pregunta abierta sobre el respaldo en [`alcance.md`](alcance.md).

### Relay (escritorio)

El Worker de Starless, parametrizado: repo, etiquetas, marcador del issue y
límite por IP. Cada app lo despliega en su propia cuenta de Cloudflare, y el
token de GitHub vive como secreto del Worker, nunca en la app.

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
- La configuración, si hace falta, va en la clave `"star"` del `package.json`
  de la app. No en `vite.config.ts`: Vite+ valida sus propias claves.
