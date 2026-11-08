/**
 * Un error para la persona que corre el comando.
 *
 * Se muestra sólo el mensaje, sin stack: es algo que hay que arreglar en el
 * repositorio (una versión que no coincide, una sección que falta), no un bug
 * del kit. Cualquier otro error sí se muestra entero.
 */
export class StarError extends Error {
  override name = "StarError";
}
