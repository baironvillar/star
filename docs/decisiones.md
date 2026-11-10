# Decisiones

Cada decisión con su porqué. Si una cambia, no se borra: se marca como
reemplazada y se agrega la nueva abajo.

## 1. Oxc (`vp check`) y no Biome

Vite+ hace formato, lint y tipos en una pasada con Oxfmt, Oxlint y tsgolint, y
flotas ya lo usa así. Mezclar Biome en el mismo repo deja `vp check` casi vacío
y dos configuraciones que discuten. En las apps, la puerta del kit es
configurable: Starless, que usa Biome, la apunta a `biome check` + `bun test`.

## 2. Repo propio, no un paquete dentro de flotas

El kit es para varias apps, y su versión y su historia no tienen que ver con
las de flotas. flotas lo consume por pull request, como cualquier otra app.

## 3. Bun y TypeScript sin build mientras sea privado

Bun ejecuta TypeScript directo, así que instalar desde git funciona sin
compilar. `vp pack` agrega un paso que hoy no resuelve nada; entra cuando se
publique en npm.

## 4. El CLI en la raíz del repo

Bun no instala un subdirectorio de un repo git. Si el CLI viviera en
`packages/cli`, no se podría instalar con `github:baironvillar/star`.

## 5. No se reinventa `tauri-action` ni el updater

`tauri-action` v1 ya compila, firma, crea la release, sube instaladores y firmas,
renombra los assets (`releaseAssetNamePattern`) y genera `latest.json`. El kit
valida antes y verifica después.

## 6. La lógica en el CLI, no en el YAML

Starless tiene la lógica en PowerShell dentro del workflow, y varias fallas
vinieron de ahí (un `exit` con el código de git, CRLF en las notas). En
TypeScript se prueba con tests, corre igual en local y en la CI, y en Windows y
Linux.

## 7. Windows y Linux primero; macOS después

Firmar y notarizar en macOS exige una cuenta de Apple Developer y un flujo
propio. Se hace cuando Windows y Linux estén bien hechos.

## 8. Primeros consumidores: flotas (web) y Starless (escritorio)

flotas no va a tener cliente de escritorio. Usa el núcleo y el target `web`. El
target `tauri` lo estrena Starless cuando migre.

## 9. El nombre es star

Hay que escribirlo en cada comando (`star release minor`, `star doctor`), así
que tiene que ser corto. Además calza con Starless y starscreen. En npm `star`
está tomado por un paquete abandonado, así que al publicar va con scope
(`@baironvillar/star`) y el comando sigue siendo `star`. En algunas
distribuciones de Linux existe un archivador de cintas con el mismo nombre; como
el kit se instala como dependencia de desarrollo, dentro de `vp run` y `bunx`
gana el binario local.

## 10. Repo público

Un workflow reutilizable en un repo público se llama desde cualquier repo sin
configurar nada, y quien quiera ayudar puede leerlo sin que lo agreguen como
colaborador. Que el repo sea público no lo convierte en un producto: sigue
hecho para mis apps.

## 11. star es la librería; liftoff es la interfaz gráfica

La librería (CLI, workflows, hooks, plantillas) se desarrolla acá.
[liftoff](https://github.com/baironvillar/liftoff) va a ser una extensión con
interfaz gráfica construida encima de star, en su propio repo. Separarlas obliga
a que todo lo que haga la interfaz se pueda hacer desde la terminal.

## 12. `release` en dos fases

El bump vuelve a `develop` por un pull request y se mergea con squash, así que
el commit que llega no es el de la rama. El tag no se puede crear hasta después
del merge: `star release <nivel>` deja la versión en un PR y
`star release finish` la mergea y crea el tag.

`finish` mergea él mismo para que el asunto sea la versión sola. Mergeado a
mano, GitHub le agrega el número del PR, y el workflow de release rechaza ese
commit. Antes había que acordarse de borrarlo en cada release.

## 13. Los hooks llaman a star; la regla está en TypeScript

La propuesta original era llevar los `commit-msg` y `pre-push` de flotas, en
`sh`, como archivos del kit. Se escribieron en TypeScript (`conventions.ts`) y
la app guarda una línea por hook que llama a `bunx star hook`.

- Se prueban con Vitest como el resto, sin depender de `grep` ni de la
  collation del sistema.
- Bun ya es requisito de cualquier app que use star, así que el hook no suma
  dependencias.
- El hook local y la CI (`star lint`) corren el mismo código.

El costo es que cada commit arranca Bun, unos 100 ms.

## 14. Se adopta en una app hecha o desde cero

star tiene que entrar igual en una app que ya existe (con historial, tags,
hooks y CI propios) que en una que recién empieza. Cada pieza se piensa con los
dos casos:

- **No exige el pasado.** `star lint commits` revisa sólo los commits nuevos;
  `doctor` pide notas sólo a la versión que ya tiene tag. Adoptar star no
  convierte en error lo que ya estaba mergeado.
- **No pisa lo que hay.** `init` pregunta antes de reemplazar un archivo con
  otro contenido y no toca lo que es de la app (un `pre-commit` propio).
- **Crea lo que falta.** En una app nueva, `init` escribe lo mínimo
  (`CHANGELOG.md`, hooks) y `doctor` dice qué comando lo crea.
- **Se salta lo que no aplica.** Sin `vite.config.ts` no hay tarea `release`
  que revisar; sin `src-tauri/` no hay updater.

## 15. Los workflows usan el star instalado en la app

La propuesta era que `verify.yml` descargara star en la misma versión que el
workflow (`job_workflow_sha`). Usa el que la app tiene instalado (`bunx star`):

- La regla que pasó en local (`star release`, los hooks) es la misma que corre
  en la CI. Con dos copias, una app podía pasar en local y fallar en el tag.
- No hay un segundo checkout ni un segundo `bun install`.

El costo es que el workflow y el paquete pueden quedar en versiones distintas.
`doctor` lo avisa, y la regla es subir los dos juntos.

## 16. El canal de prueba es un sufijo en la versión

Starless marcaba prerelease todo tag que no había llegado a `main`. star
etiqueta en `develop` y `develop` llega a `main` después, así que con esa
regla toda versión habría salido como prerelease.

El canal lo dice la versión: `0.7.0-beta.1` es una prerelease y `0.7.0` es
pública. GitHub no devuelve una prerelease en `releases/latest`, que es lo que
lee el updater, así que la app instalada no ve las betas. No depende de en qué
rama quedó el tag, y se lee en el número.

- `star release minor --beta` empieza una beta, `star release beta` saca la
  siguiente y `star release minor` saca la versión final.
- **Una beta copia `## [Sin publicar]`, no lo mueve.** Lo que trae sigue sin
  publicar hasta la versión final, que sale con todas sus notas.
- `verify.yml` devuelve `prerelease` para lo que la app decida por su cuenta
  (Starless: el ícono de desarrollo y el canal que muestra en Ajustes).
