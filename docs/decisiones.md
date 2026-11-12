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
la app guarda un hook corto que llama a star por su ruta (decisión 21).

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
workflow (`job_workflow_sha`). Usa el que la app tiene instalado (`bunx star`, después de `bun install`):

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

## 17. La llave del updater: respaldo fuera del repo y sin contraseña

GitHub no deja leer un secreto después de guardarlo. Si la llave del updater
sólo viviera ahí y se perdiera, ninguna app instalada se podría volver a
actualizar. `star init updater` deja un respaldo en
`~/.star/keys/<identifier>/`, fuera del repo, para que no haya forma de
commitearlo por error, y dice que se pase a un gestor de contraseñas.

La llave se genera **sin contraseña**. `tauri signer generate` sólo la acepta
por `-p`, y en argv la vería cualquier proceso del usuario. Una contraseña
también habría que respaldarla, y guardarla al lado de la llave no protege
nada. La llave se protege por dónde vive: los secretos de GitHub y el
respaldo.

## 18. El squash sale del título y la descripción del PR

GitHub arma el mensaje de un _squash and merge_ según cuántos commits tiene el
PR. Con lo que trae por defecto, un PR con un commit usa el asunto y el cuerpo
de ese commit; uno con varios usa el título del PR como asunto y una lista de
los commits como cuerpo, y la descripción del PR no aparece. En star y
Starless "funcionaba solo" porque cada PR tenía un commit; el primer PR de
albion-calculator, con dos, dejó el mensaje por escribir a mano.

star le pide al repo que el squash salga **siempre** del título y la
descripción del PR (`PR_TITLE` y `PR_BODY`), tenga los commits que tenga:

- `star init github` cambia esos ajustes del repo. Es un cambio fuera de la
  app, en un repo que puede ser de más gente, así que muestra qué cambia y
  pregunta. Después los vuelve a leer: un cambio que GitHub acepta pero no
  guarda no se da por hecho.
- Con eso, el título del PR es el asunto del commit que llega a la base, y
  ningún hook lo puede revisar porque se escribe en GitHub. `star lint title`
  lo revisa en la CI, con la misma regla que un commit, en un workflow que
  corre también cuando se edita el título.
- `doctor` avisa si el repo no tiene esos ajustes, o si la CI no revisa el
  título.
- `star release finish` no depende de esto: le pasa a GitHub el asunto exacto
  (la versión) y un cuerpo vacío.

## 19. `main` la actualiza star, y el repo sólo permite squash

La decisión 18 dejó bien el squash, pero el merge commit seguía habilitado
porque `develop` llegaba a `main` por un PR mergeado con merge commit. GitHub
pone ese método primero en el botón, con su mensaje de siempre
("Merge pull request #N from…"), y en el primer PR de sme fue el que se ofreció.
Limitar los métodos por rama exige rulesets, que en un repo privado piden
GitHub Pro. El detalle está en
[`diagnostico-arranque-sme.md`](diagnostico-arranque-sme.md).

- **`star release finish` actualiza `main`.** Después de mergear la versión a
  `develop` y antes del tag, crea el merge commit de `develop` a `main` con la
  versión como asunto y lo empuja. Las betas no llegan a `main`. Si `main` ya
  contiene lo de `develop` (un `finish` que se cortó a la mitad), no hace nada.
- **El repo sólo permite squash.** `star init github` deshabilita el merge
  commit y el rebase. En un PR, el único botón posible es el correcto.
- **`main` no recibe pull requests.** `star lint branch --into main` lo rechaza.
- **El push a `main` lo hace star con `--no-verify`.** El hook `pre-push`
  existe para que una persona no empuje a `main`; star es el único camino
  previsto, y el merge commit lo arma él con el asunto exacto. Si el repo tiene
  protección de rama sobre `main`, el push falla y star lo dice.
- **El tag sigue sobre el commit de `develop`**, que queda como primer padre
  del merge en `main`. El canal sale del sufijo de la versión (decisión 16), no
  de dónde está el commit, así que los workflows no cambian.

## 20. `star init github` arranca el repo completo

Lo de GitHub estaba repartido en piezas que había que conocer: `init hooks`,
`init github`, el workflow del título y una plantilla de PR que star no
tenía. `doctor` las detectaba, pero en sme el primer PR salió sin ellas.
`star init github` hace ahora todo lo que el repo en GitHub necesita, en orden,
mostrando el plan y preguntando una vez:

1. **Repo vacío:** crea un commit inicial con los archivos del punto 3, crea
   `main` y la base desde él y los empuja (es el otro push a esas ramas que
   hace star). Si la rama actual todavía no tiene commits, la apunta al mismo
   commit, para que el primer PR comparta historia con la base. Si falta sólo
   una de las dos ramas, la crea desde la otra.
2. **Rama por defecto: la base.** Es el destino de todo PR, y GitHub lee de
   ahí la plantilla de PR.
3. **Archivos:** `.github/workflows/pr-title.yml` (`star lint title`) y
   `.github/PULL_REQUEST_TEMPLATE.md`. Sólo escribe los que faltan: una
   plantilla o un workflow que ya existe es de la app (decisión 14). En un repo
   que ya tenía historia quedan en el árbol, para commitearlos en un PR.
4. **Ajustes de merge** de la decisión 19, y los vuelve a leer después.

## 21. La app llama a star por su ruta, no con `bunx star`

Al probar `bunx star doctor` dentro del repo de star, bunx no encontró star en
`node_modules/.bin` (ahí no es dependencia), bajó de npm el paquete que se llama
`star`, una herramienta de acciones de otra persona, y lo ejecutó. En una app
pasa lo mismo en un clon sin `bun install`: el hook `commit-msg`, que llamaba a
`bunx star hook`, correría código ajeno en cada commit. `bunx --no-install` no
protege: una vez bajado, el paquete queda en la caché global de bunx.

- **Hooks, scripts y la tarea `release`** llaman a
  `bun node_modules/@baironvillar/star/src/cli.ts`. Si star no está instalado,
  fallan con un mensaje en vez de correr otra cosa. El hook lo dice: "corre bun
  install".
- **`star` a secas sigue sin servir** en Windows (el shim de Bun busca
  `bun.exe`; ver la arquitectura). `bun <ruta>` funciona en los dos casos,
  porque `bun` ya está en el PATH de quien usa star.
- **Los workflows siguen con `bunx star`.** Corren después de
  `bun install --frozen-lockfile` en un runner limpio: star siempre está en
  `node_modules`, y si la instalación falla el job se corta antes.
- **`doctor` avisa** si un script o la tarea `release` llama a `bunx star`, y
  `star init hooks` reescribe los hooks viejos, que ya no son los de star.
- La ruta sale del `name` del `package.json` de star (`src/command.ts`): si se
  publica con otro nombre, cambia en un solo lugar.

## 22. `autoMerge`: la release se termina sola, en la terminal

Con `"star": { "autoMerge": true }`, `star release` no se detiene en el PR:
espera el CI y hace el `finish`. Sin la clave, nada cambia.

- **En la terminal, no en GitHub Actions.** Un tag empujado desde un workflow
  con el `GITHUB_TOKEN` no dispara otros workflows, así que el de release no
  correría. Hacerlo en Actions pediría un token personal guardado como secreto,
  y el kit evita sumar secretos (regla 1). En la terminal el tag lo empuja la
  persona, como siempre.
- **Se pregunta una vez.** La pregunta de preparar dice que la versión se
  termina sola cuando el CI pase; volver a preguntar después de esperar el CI
  le pediría a alguien que se quede mirando.
- **Espera con límite.** Cada 15 segundos, hasta 30 minutos. Un PR recién
  abierto no tiene checks por unos segundos: "sin checks" cuenta como "todavía
  no" durante el primer minuto. Al rendirse no toca nada, y
  `star release finish` retoma; con `autoMerge` también espera.
- **Un CI que falla no se mergea**, igual que en `finish`.
- **No es el auto-merge de GitHub.** Ése mergea con el squash del repo, pero
  no actualiza `main` ni crea el tag, y exige protección de rama con checks
  requeridos. Para los PR de features sigue pendiente.
