# Alcance

Este documento se discute y se ajusta. Lo que diga acá manda sobre el resto de
la documentación: si cambia el alcance, se cambia primero acá.

## El problema

Publicar una versión de una app tiene una lista de cosas que tienen que ser
verdad al mismo tiempo, y cada una que falla tiene un costo distinto:

- La versión dice una cosa en `package.json` y otra en `tauri.conf.json` o en
  `Cargo.toml`: la app instalada nunca encuentra su actualización.
- El tag no coincide con la versión: `latest.json` promete un archivo que la app
  nunca va a pedir.
- Faltan las notas: la CI se detiene **después** de que el tag ya se empujó, y
  arreglarlo implica mover un tag publicado.
- Se publica desde la rama equivocada: sale una versión que nadie aprobó.
- Se publica algo que no pasa lint ni tests: compila, pero no es para entregar.

Hoy cada app resuelve esto por su cuenta, o no lo resuelve. Starless lo resolvió
bien pero sólo para Starless.

## Objetivo

Que en cualquiera de mis apps con Vite publicar sea `vp run release <nivel>`, y
que el kit cobre todos esos chequeos sin que cada app los copie.

## Qué entra

### Núcleo (cualquier app)

- **Versión única.** Leer, validar y escribir la versión en todos los
  manifiestos de la app: `package.json` raíz y workspaces, `tauri.conf.json`,
  `Cargo.toml` y `Cargo.lock`. Editando sólo el número, sin reformatear nada.
- **Changelog.** Extraer la sección `## [x.y.z]` de `CHANGELOG.md`. Es el cuerpo
  de la release y, en escritorio, las notas que ve el usuario.
- **`release`.** Puerta (`vp check` + `vp test` por defecto, configurable),
  chequeos de rama `release/<versión>`, tag libre y notas presentes, bump,
  commit `x.y.z`, tag y push. Pregunta antes de escribir.
- **Hooks de git.** `commit-msg` y `pre-push` con la convención de mensajes y
  ramas, el mismo archivo para el hook local y la CI.
- **`doctor`.** Diagnostica qué falta o está mal en la app: manifiestos,
  changelog, hooks, secretos (sólo nombres), llaves privadas en el árbol.
- **Workflow `verify.yml`.** Reutilizable: tag contra versión, mensaje del
  commit, notas y puerta.

### Target `web`

- Crear la release en borrador con las notas del changelog y los assets que la
  app adjunte, y verificarla antes de publicarla.
- La imagen Docker, el empaquetado de la web y el despliegue **no** son del kit:
  quedan en el workflow de la app.

### Target `tauri`

- Workflow reutilizable con `tauri-action` v1 en Windows y Linux.
- `init` del updater: genera las llaves, sube los secretos a GitHub con
  `gh secret set` sin que la llave ni la contraseña aparezcan en pantalla, y
  escribe la llave pública en la configuración.
- Verificación de `latest.json` en la release en borrador: una entrada por
  plataforma, firmas presentes, notas iguales al changelog.
- Canal: un tag que no llegó a `main` sale como prerelease.
- Plantilla del relay (Cloudflare Worker) que convierte crashes y feedback en
  issues de GitHub, desplegado en la cuenta de cada app.

### Más adelante

- Plugin de Tauri (crate + paquete npm): revisar actualizaciones, mostrar "qué
  hay de nuevo" desde el changelog y enviar crashes y feedback al relay.

## Qué no entra

- **Compilar.** Eso lo hacen `tauri-action`, `vp build`, Docker.
- **Reemplazar el updater de Tauri** o generar `latest.json` a mano:
  `tauri-action` ya lo hace.
- **macOS** (firma y notarización) en la primera versión.
- **Desplegar** una app web a un proveedor.
- **Reparar releases viejas** publicadas con otro flujo, como hace hoy
  `releases.ts sync` en Starless.
- **Ser genérico para cualquiera.** Las convenciones son las mías (ramas,
  commits en inglés, docs en español). Se generaliza cuando una segunda persona
  lo necesite, no antes.

## Reglas

- Ningún secreto se imprime, se commitea ni queda dentro de una app.
- Cada pieza la consume una app real (flotas o Starless). Si no, no se hace.
- No se reinventa lo que ya hace `tauri-action` ni el updater oficial.
- Windows y Linux primero, bien hechos.

## Preguntas abiertas

Para discutir. Cuando se decida una, se mueve a [`decisiones.md`](decisiones.md).

1. **Respaldo de la llave del updater.** Si la llave privada sólo vive en los
   secretos de GitHub y se pierde, todas las instalaciones quedan sin
   actualizaciones para siempre. ¿`init` exige elegir dónde guardar un respaldo
   (ruta fuera del repo, gestor de contraseñas)?
2. **Release en borrador o publicada.** Starless deja la release en borrador y
   se publica a mano. ¿El kit agrega un `star publish` que verifica y la saca
   de borrador, o se sigue publicando a mano?
3. **Convenciones configurables.** ¿Los tipos de commit, el largo máximo y el
   formato de las ramas se pueden cambiar por app, o son fijos?
4. **Monorepos con más de una app publicable.** flotas publica API y web juntas
   con una sola versión. ¿Hace falta soportar versiones distintas por paquete?
   Hoy la respuesta propuesta es no.
5. **Tags en otro formato.** star lee y crea tags `v1.2.3`. Una app hecha puede
   tener tags `1.2.3` o `app-v1.2.3`. ¿Se configura el prefijo, o se pide
   migrar los tags al adoptar star? Se decide cuando aparezca una app así.
