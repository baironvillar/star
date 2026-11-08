# star

> **Estado: en diseño.** No hay código todavía. Este repositorio por ahora
> contiene la descripción del proyecto, su alcance y el plan, para discutirlos
> antes de escribir la primera línea.

star es la librería: el CLI, los workflows reutilizables, los hooks y las
plantillas. [liftoff](https://github.com/baironvillar/liftoff) va a ser una
extensión con interfaz gráfica construida encima de star, y se desarrolla
aparte.

Un kit de releases para mis apps hechas con Vite: clientes de escritorio con
Tauri 2 y SaaS web. La idea es que en cualquiera de ellas publicar una versión
sea un solo comando:

```bash
vp run release minor
```

y que ese comando no deje salir nada que no esté en orden: la versión igual en
todos los manifiestos, las notas escritas en el changelog, el lint, los tipos y
los tests en verde, la rama correcta, el tag libre. Después del push del tag, la
CI hace el resto con un workflow reutilizable que cada app llama en unas diez
líneas, en vez de copiar cientos de líneas de YAML.

No es una librería pública. Está hecho para mis apps y mi forma de trabajar. Si
después de usarlo en dos o tres apps queda pulido, se publica.

## Por qué existe

[Starless](https://github.com/baironvillar/Starless) ya resolvió el flujo de
releases, pero pegado a esa app: unas 3.000 líneas de scripts y workflows con
el nombre de la app escrito adentro, sólo para Windows y en PowerShell. Cada app
nueva tendría que copiarlas y adaptarlas, y cada arreglo habría que hacerlo en
todas. El kit saca de ahí lo que vale la pena (los chequeos y los porqués), lo
generaliza y lo integra con [Vite+](https://viteplus.dev).

El diagnóstico completo de qué se lleva y qué se deja está en
[`docs/diagnostico-starless.md`](docs/diagnostico-starless.md).

## Qué hace (y qué no)

El kit no compila ni reemplaza a las herramientas oficiales. Su valor está en lo
que pasa **antes** y **después** del build:

| Antes del build                              | El build (no es del kit)                    | Después del build                                   |
| -------------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| Versión única y validada en los manifiestos  | `tauri-action` en una app de escritorio     | Verificar la release en borrador antes de publicarla |
| Notas obligatorias desde `CHANGELOG.md`      | Docker, `vp build`, etc. en una app web     | `latest.json` completo y firmado (escritorio)       |
| `vp check` y `vp test` como puerta           |                                             | Relay de crashes y feedback (escritorio)            |
| Rama, tag y mensaje del commit en regla      |                                             |                                                     |

Se divide en dos capas:

- **Núcleo, para cualquier app con Vite:** versión, changelog, el comando
  `release`, hooks de git, `doctor` y el workflow reutilizable de verificación.
- **Targets, lo que se publica:**
  - `web`: release en borrador con las notas y los assets que la app adjunte.
    La imagen Docker y el despliegue quedan en el workflow de cada app.
  - `tauri`: build con `tauri-action` en Windows y Linux, updater (llaves y
    secretos), verificación de `latest.json` y la plantilla del relay.

Detalle en [`docs/arquitectura.md`](docs/arquitectura.md).

## Plataformas

- **Windows y Linux:** el objetivo de la primera versión.
- **macOS: todavía no.** Firmar y notarizar exige una cuenta de Apple Developer
  y un flujo propio. Queda fuera hasta que Windows y Linux estén bien hechos. Una
  app que necesite macOS hoy no tiene soporte en el kit.

## Consumidores

Cada pieza del kit tiene que servirle a una app real. Si no le sirve a ninguna,
no se construye.

| App                                                      | Tipo                 | Qué usa                         | Cuándo        |
| -------------------------------------------------------- | -------------------- | ------------------------------- | ------------- |
| [flotas](https://github.com/baironvillar/flotas)         | SaaS web (Vite+)     | núcleo + target `web`           | primero       |
| [Starless](https://github.com/baironvillar/Starless)     | Escritorio (Tauri 2) | núcleo + target `tauri`         | después       |

## Cómo se usaría (previsto, no implementado)

```bash
bun add -d github:baironvillar/star#v0.1.0
bunx star init
```

```ts
// vite.config.ts de la app
export default defineConfig({
  run: {
    tasks: {
      verify: ["vp check", "vp test run"],
      release: { command: "star release", cache: false, dependsOn: ["verify"] },
    },
  },
});
```

```yaml
# .github/workflows/release.yml de la app
on:
  push:
    tags: ["v*"]
jobs:
  verify:
    uses: baironvillar/star/.github/workflows/verify.yml@v0
  release:
    needs: verify
    uses: baironvillar/star/.github/workflows/tauri-release.yml@v0
    secrets: inherit
```

## Documentos

- [`docs/alcance.md`](docs/alcance.md): qué entra, qué no, y las preguntas
  abiertas. **Es el documento para discutir y ajustar.**
- [`docs/arquitectura.md`](docs/arquitectura.md): estructura del repo, piezas y
  cómo las instala una app.
- [`docs/decisiones.md`](docs/decisiones.md): las decisiones tomadas y por qué.
- [`docs/diagnostico-starless.md`](docs/diagnostico-starless.md): qué se lleva
  de Starless y qué se mejora.
- [`ROADMAP.md`](ROADMAP.md): el plan por pasos.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): ramas, commits y cómo proponer cambios.

## Stack

- [Bun](https://bun.sh) como gestor de paquetes y runtime.
- [Vite+](https://viteplus.dev) (`vp`) como toolchain: `vp check` (Oxfmt,
  Oxlint y tsgolint), `vp test` y tareas con caché.
- [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) v1 y
  el [updater oficial](https://v2.tauri.app/plugin/updater/) de Tauri para el
  target de escritorio.
