# AGENTS.md

Contexto para cualquier agente que toque este repositorio.

star es un kit de releases para apps con Vite (SaaS web y escritorio con
Tauri 2). **En uso:** flotas (web) y Starless (escritorio) publican con star.
Están hechas la fase 1 y casi toda la fase 2 del [`ROADMAP.md`](ROADMAP.md),
que marca qué está hecho y qué sigue. Antes de cambiar algo, lee
[`docs/alcance.md`](docs/alcance.md) (qué entra y qué no) y
[`docs/decisiones.md`](docs/decisiones.md) (lo ya decidido).

## Reglas que no se rompen

1. **Ningún secreto se imprime, se commitea ni queda dentro de una app.** Las
   llaves y contraseñas pasan por stdin, nunca por argv ni por un log.
2. **No se reinventa `tauri-action` ni el updater de Tauri.** El kit valida
   antes del build y verifica después.
3. **Cada pieza la consume una app real** (flotas o Starless). Si no, no se hace.
4. **Los manifiestos se editan como texto**: nunca se vuelve a serializar un
   JSON o un TOML para cambiar la versión.
5. **La lógica vive en el CLI, no en el YAML** de los workflows.
6. **Ramas y commits:** ver [`CONTRIBUTING.md`](CONTRIBUTING.md). Nunca se
   commitea a `develop` ni a `main`.
7. **Idiomas:** código, commits, ramas y PRs en inglés. Documentación,
   comentarios y texto para personas, en español de Chile.

## Stack

Bun es el gestor y el runtime; Vite+ (`vp`) es el toolchain (`vp check` con
Oxc, `vp test`). Vite+ cambia rápido: revisa la documentación de la versión
instalada (`node_modules/vite-plus/docs`) antes de diseñar sobre ella.

## Comandos

```bash
bun install             # nunca npm ni `vp install`
bun run check           # vp check: formato, lint y tipos. La puerta de cada cambio
bun run test            # vp test run
bun run star -- version # el CLI desde el código
```

## Mapa

```
src/cli.ts              comandos y salida; nada de lógica que no se pueda probar aparte
src/command.ts          cómo llama una app a star: por su ruta, nunca con bunx star
src/version.ts          leer todos los manifiestos, planificar y aplicar la escritura
src/semver.ts           parsear y subir versiones, betas incluidas
src/readiness.ts        los chequeos antes de un bump (git es una interfaz, se prueba con un doble)
src/release.ts          star release (y sus betas) y star release finish (git y gh entran como dependencias)
src/verify.ts           star verify: todo lo que se revisa antes de construir un tag
src/updater.ts          star release check: latest.json y firmas de una release de escritorio
src/doctor.ts           star doctor: qué le falta a la app para publicar con star
src/conventions.ts      las reglas de commits, ramas y títulos de PR, escritas una sola vez
src/hooks.ts            star init hooks y star hook: los hooks de git que llaman a esas reglas
src/updater-init.ts     star init updater: llave del updater, respaldo fuera del repo y secreto
src/relay-init.ts       star init relay: copia la plantilla de templates/relay a la app
src/github-init.ts      star init github: ramas, archivos y ajustes para que el primer PR ya cumpla
src/merge-settings.ts   los ajustes del repo: sólo squash, desde el título y la descripción del PR
src/config.ts           la clave "star" del package.json de la app: base y puerta
src/git.ts, src/gh.ts   las únicas piezas que llaman a git y a gh
src/prompt.ts           preguntar en la terminal, y qué hacer cuando no hay nadie
src/errors.ts           StarError: un error para la persona, sin stack
src/testing/            dobles para los tests
src/manifests/          un adaptador por formato, sobre texto: read y write sin tocar el disco
src/changelog.ts        la sección de una versión, escrita una sola vez
src/json-text.ts        ubicar una clave de primer nivel en un JSON sin reformatearlo
templates/relay/        el Worker que recibe los reportes de las apps
templates/github/       el workflow del título y la plantilla de PR que escribe init github
.github/workflows/      verify.yml, web-release.yml y tauri-release.yml son reutilizables;
                        ci.yml, pr-title.yml y release.yml son de este repo
```
