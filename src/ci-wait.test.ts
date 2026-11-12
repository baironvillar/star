import { describe, expect, it } from "vite-plus/test";
import { CHECKS_GRACE_MS, type Clock, POLL_MS, WAIT_LIMIT_MS, waitForChecks } from "./ci-wait.ts";
import type { PullRequest } from "./gh.ts";

/** Un reloj que sólo avanza cuando se espera. */
function clock(): Clock {
  let t = 0;
  return {
    sleep: async (ms) => {
      t += ms;
    },
    now: () => t,
  };
}

describe("waitForChecks", () => {
  const silent = { log: () => {}, warn: () => {}, confirm: async () => true };
  const open = (checks: PullRequest["checks"]): PullRequest => ({
    number: 7,
    url: "https://github.com/x/app/pull/7",
    state: "OPEN",
    checks,
    mergeable: true,
  });
  /** Un gh que contesta los estados en orden y repite el último. */
  function answers(...prs: PullRequest[]): () => PullRequest | null {
    let i = 0;
    return () => prs[Math.min(i++, prs.length - 1)] ?? null;
  }

  it("espera mientras el CI corre y devuelve cómo terminó", async () => {
    const time = clock();
    const pr = await waitForChecks(
      { io: silent, ...time },
      answers(open("none"), open("pending"), open("passing")),
      "star release finish 0.2.0",
    );
    expect(pr?.checks).toBe("passing");
    expect(time.now()).toBe(2 * POLL_MS);
  });

  it("sin checks espera un rato a que aparezcan, y después sigue", async () => {
    const time = clock();
    const pr = await waitForChecks(
      { io: silent, ...time },
      answers(open("none")),
      "star release finish 0.2.0",
    );
    expect(pr?.checks).toBe("none");
    expect(time.now()).toBeGreaterThanOrEqual(CHECKS_GRACE_MS);
  });

  it("devuelve un CI que falló sin esperar más", async () => {
    const time = clock();
    const pr = await waitForChecks(
      { io: silent, ...time },
      answers(open("failing")),
      "star release finish 0.2.0",
    );
    expect(pr?.checks).toBe("failing");
    expect(time.now()).toBe(0);
  });

  it("se rinde al pasar el límite, y dice cómo seguir", async () => {
    const time = clock();
    await expect(
      waitForChecks({ io: silent, ...time }, answers(open("pending")), "star release finish 0.2.0"),
    ).rejects.toThrow(/star release finish 0\.2\.0/);
    expect(time.now()).toBeGreaterThanOrEqual(WAIT_LIMIT_MS);
  });
});
