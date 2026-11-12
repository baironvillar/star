import pkg from "../package.json" with { type: "json" };

/**
 * Cómo llama una app a star: por la ruta del paquete instalado, nunca con
 * `bunx star` (decisión 21).
 *
 * `bunx star` busca `star` en `node_modules/.bin` y, si no está (un clon sin
 * `bun install`, o el propio repo de star), baja de npm el paquete que se llama
 * `star` y lo ejecuta. Ese paquete existe y es de otra persona: pasó al probar
 * `bunx star doctor` en el repo de star. `--no-install` no protege, porque una
 * vez bajado queda en la caché global de bunx. Con la ruta, si star no está, el
 * comando falla en vez de correr código ajeno.
 */
export const STAR_CLI = `node_modules/${pkg.name}/src/cli.ts`;

/** El comando entero, para scripts, tareas y los mensajes que sugieren uno. */
export const STAR = `bun ${STAR_CLI}`;
