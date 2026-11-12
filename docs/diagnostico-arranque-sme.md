# Diagnóstico: el arranque de sme

sme fue la primera app que adoptó star **desde un repo vacío**. Llegar a un
primer PR que cumpliera la convención tomó tres intentos. Este documento dice
qué falló en cada uno, qué parte era de star y qué hay que cambiar para que un
solo comando lo deje bien.

## Lo que pasó

### Intento 1: el PR salió sin la configuración de GitHub

Se corrió `star init hooks`, se abrió el PR y la CI falló. Lo de GitHub quedó
fuera por completo:

- El squash seguía con lo de GitHub por defecto (`COMMIT_OR_PR_TITLE` +
  `COMMIT_MESSAGES`). Faltaba `star init github`.
- No había workflow con `star lint title`: el título del PR, que es el asunto
  del commit en `develop`, no lo revisaba nadie.
- No había plantilla de PR, así que la descripción, que es el cuerpo del commit,
  quedó escrita a mano y sin forma.

**Por qué:** cada pieza es un comando o un archivo aparte, y `doctor`, que sí
las detecta, termina con "nada que frene". Nada obliga a correrlo antes del
primer PR, y nada indica que en un repo nuevo esos avisos son el arranque
incompleto y no detalles.

La falla de la CI fue otra cosa, de la app y no de star: un archivo generado
(`database.types.ts`) escrito a mano que no coincidía con el que genera el job.

### El arranque en un repo vacío

Antes del primer PR había que crear `main` y `develop`, y star no lo cubre:

- No hay comando que cree el commit inicial y las dos ramas largas.
- El hook `pre-push` de star bloquea, con razón, empujar a `main` y `develop`.
  En el arranque no queda otra que usar `--no-verify`, que es justo lo que el
  hook intenta evitar.
- La rama por defecto en GitHub queda en `main` (o vacía). Hay que cambiarla a
  mano a `develop`, que es la base de todo PR.
- GitHub lee la plantilla de PR **desde la rama por defecto**. Si la plantilla
  llega en el primer PR, ese PR no la tiene.

### Intento 2: el botón de merge proponía otro mensaje

Con el squash ya configurado, el diálogo de merge proponía
`Merge pull request #1 from baironvillar/docs/project-foundations`, con el
título del PR como cuerpo.

**Por qué:** era el diálogo de **Create a merge commit**, no el de squash.
`star init github` sólo configura el squash y deja los otros dos métodos como
vienen:

- El merge commit queda habilitado, porque la convención lo usa de `develop` a
  `main`, y GitHub lo ofrece como primera opción del botón.
- Su mensaje sigue siendo el de GitHub por defecto (`MERGE_MESSAGE` +
  `PR_TITLE`).
- El rebase queda habilitado aunque la convención nunca lo usa.

No hay forma de limitar los métodos por rama en un repo privado sin GitHub
Pro (los rulesets devuelven 403), así que no alcanza con "squash a develop,
merge commit a main" como ajuste del repo.

## Qué es de star

| Falla                                     | De star | Arreglo                                  |
| ----------------------------------------- | ------- | ---------------------------------------- |
| La configuración de GitHub quedó fuera    | sí      | un solo `star init github` que deja todo |
| Sin workflow de título ni plantilla de PR | sí      | `init github` los escribe                |
| Repo vacío: ramas, push, rama por defecto | sí      | `init github` arranca el repo            |
| El merge commit es el botón por defecto   | sí      | `main` la actualiza star; sólo squash    |
| Archivo generado escrito a mano           | no      | regla de la app                          |

## Propuesta: `star init github` arranca el repo completo

Un solo comando, en el repo conectado al `origin`, que muestra todo lo que va a
hacer, pregunta una vez y después vuelve a leer cada cosa para confirmar que
quedó:

1. **Si el repo está vacío:** crea un commit inicial que ya trae la
   configuración de los puntos 3 y 4, crea `main` y `develop` desde él y los
   empuja. Es el único push a esas ramas que hace star, y lo hace él, sin
   pedirle a la persona que se salte su propio hook.
2. **Rama por defecto: `develop`.**
3. **Archivos:** `.github/workflows/pr-title.yml` con `star lint title` y
   `.github/PULL_REQUEST_TEMPLATE.md`. Siguen la decisión 14: no pisan uno
   que ya existe con otro contenido sin preguntar.
4. **Ajustes de merge:** sólo squash, desde el título y la descripción del PR.
5. **`doctor`:** todo lo que falte de este arranque apunta al mismo comando,
   `bunx star init github`.

## Cómo llega `develop` a `main`

Hoy una persona abre un PR de `develop` a `main` y lo mergea con merge commit.
Por eso el merge commit tiene que estar habilitado, y por eso aparece como
botón por defecto en los PR de cada día. Hay dos caminos:

**A. Lo hace star y el repo sólo permite squash.** `star release finish`, que
ya mergea el PR de la versión, también crea el merge commit de `develop` a
`main` con la versión como asunto y lo empuja. En el repo quedan deshabilitados
el merge commit y el rebase: el botón sólo puede hacer squash y no hay forma de
equivocarse. Cambia el flujo de publicar y exige revisar dónde se crea el tag.

**B. Sigue siendo un PR, y se ajusta el mensaje.** Se mantiene el merge commit,
pero con `PR_TITLE` + `PR_BODY`, y se deshabilita el rebase. Equivocarse de
botón en un PR de cada día produce un merge commit con el asunto correcto, pero
la historia de `develop` deja de ser lineal.

**Se eligió A:** es la única que hace imposible el error. Quedó como la
decisión 19 de [`decisiones.md`](decisiones.md), y el arranque completo como la
decisión 20.
