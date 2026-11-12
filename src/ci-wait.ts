import { StarError } from "./errors.ts";
import type { PullRequest } from "./gh.ts";

/** El tiempo, como dependencia: en los tests no se espera de verdad. */
export type Clock = {
  /** Espera; en los tests, nada. */
  sleep(ms: number): Promise<void>;
  /** Milisegundos desde el epoch: para el límite de la espera. */
  now(): number;
};

/** Cada cuánto se le pregunta a GitHub por el CI. */
export const POLL_MS = 15_000;
/** Cuánto se espera a que un PR recién abierto tenga checks. */
export const CHECKS_GRACE_MS = 60_000;
/** Cuánto se espera al CI antes de rendirse. */
export const WAIT_LIMIT_MS = 30 * 60_000;

/**
 * Espera a que el CI de un PR termine, y devuelve el PR como quedó.
 *
 * La usan `star release` (con `autoMerge`) y `star pr merge`. Un PR recién
 * abierto no tiene checks por unos segundos, hasta que GitHub agenda los
 * workflows: "sin checks" se toma como "todavía no" durante `CHECKS_GRACE_MS`,
 * y después como lo que es. Al pasar `WAIT_LIMIT_MS` se rinde sin tocar nada, y
 * dice con qué comando (`resume`) seguir.
 */
export async function waitForChecks<T extends PullRequest>(
  deps: Clock & { io: { log(message: string): void } },
  fetch: () => T | null,
  resume: string,
): Promise<T | null> {
  const start = deps.now();
  let announced = false;
  for (;;) {
    const pr = fetch();
    if (!pr || pr.state !== "OPEN") return pr;
    const elapsed = deps.now() - start;
    const waiting = pr.checks === "pending" || (pr.checks === "none" && elapsed < CHECKS_GRACE_MS);
    if (!waiting) return pr;
    if (elapsed >= WAIT_LIMIT_MS) {
      throw new StarError(
        `el CI del PR #${pr.number} sigue corriendo después de ${WAIT_LIMIT_MS / 60_000} minutos. No se tocó nada: cuando termine, corre \`${resume}\`.`,
      );
    }
    if (!announced) {
      deps.io.log(
        `Esperando el CI del PR #${pr.number}… (con Ctrl+C lo dejas, y sigues con \`${resume}\`)`,
      );
      announced = true;
    }
    await deps.sleep(POLL_MS);
  }
}
