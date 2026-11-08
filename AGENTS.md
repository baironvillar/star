# AGENTS.md

Contexto para cualquier agente que toque este repositorio.

star es un kit de releases para apps con Vite (SaaS web y escritorio con
Tauri 2). **Está en diseño: todavía no hay código.** Antes de cambiar algo, lee
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
