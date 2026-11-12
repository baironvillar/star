import { createInterface } from "node:readline";

/**
 * Si hay alguien para contestar.
 *
 * Bajo `vp run`, una tarea cacheada corre sin TTY y una con `cache: false`
 * recibe la terminal (probado con Vite+ 1.5.0). Por eso la tarea `release` de
 * una app tiene que ser `cache: false`.
 */
export function interactive(): boolean {
  return Boolean(process.stdin.isTTY);
}

/**
 * Una pregunta, una respuesta.
 *
 * **Contesta aunque nadie conteste.** Un stdin vacío se cierra sin una línea, y
 * esperar esa línea para siempre cuelga un job de CI sin explicación. Una
 * respuesta vacía es una respuesta.
 */
export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.on("close", () => {
      if (!answered) {
        answered = true;
        resolve("");
      }
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Sí, no, o nadie contestó.
 *
 * **Tres respuestas, no dos.** Enter sin escribir en una terminal es "no". Una
 * respuesta vacía sin terminal es que no hay nadie, y eso es otra cosa: el
 * comando tiene que decirlo en vez de escribir la versión a ciegas.
 */
export async function confirm(question: string): Promise<"yes" | "no" | "unanswered"> {
  const answer = (await ask(`${question} [s/N] `)).toLowerCase();
  if (["s", "si", "sí", "y", "yes"].includes(answer)) return "yes";
  if (answer === "") return interactive() ? "no" : "unanswered";
  return "no";
}
