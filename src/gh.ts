import { spawnSync } from "node:child_process";
import { StarError } from "./errors.ts";

export type PullRequest = {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  /** El resumen de los checks del último commit. */
  checks: "passing" | "failing" | "pending" | "none";
  /** `false` si tiene conflictos; `null` si GitHub todavía no lo calcula. */
  mergeable: boolean | null;
};

/** Lo que el kit le pide a GitHub, a través de `gh`. Interfaz para probarlo con un doble. */
export type Gh = {
  /** Si `gh` está instalado y con sesión. */
  available(): boolean;
  /** Abre el PR y devuelve su URL. */
  createPr(input: { base: string; head: string; title: string; body: string }): string;
  /** El PR más reciente de esa rama, abierto o no. */
  findPr(head: string): PullRequest | null;
  /** Squash and merge con el asunto exacto y sin cuerpo. */
  mergeSquash(number: number, subject: string): void;
};

type Rollup = { status?: string; conclusion?: string; state?: string };

/**
 * Los checks de un PR, reducidos a una palabra.
 *
 * `statusCheckRollup` mezcla dos tipos: los check runs de Actions (con `status`
 * y `conclusion`) y los commit statuses de otros servicios (con `state`). Un
 * neutral o un skipped no frena nada; un cancelado sí, porque no prueba nada.
 */
export function summarizeChecks(rollup: Rollup[]): PullRequest["checks"] {
  if (rollup.length === 0) return "none";
  let pending = false;
  for (const item of rollup) {
    const result = (item.conclusion || item.state || "").toUpperCase();
    const status = (item.status ?? "").toUpperCase();
    if (
      ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(
        result,
      )
    ) {
      return "failing";
    }
    if (
      result === "PENDING" ||
      result === "EXPECTED" ||
      (status !== "" && status !== "COMPLETED")
    ) {
      pending = true;
    }
  }
  return pending ? "pending" : "passing";
}

export function ghIn(cwd: string): Gh {
  function run(args: string[], input?: string) {
    const r = spawnSync("gh", args, { cwd, encoding: "utf8", input, timeout: 60_000 });
    return { status: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
  }

  return {
    available: () => run(["auth", "status"]).status === 0,
    createPr({ base, head, title, body }) {
      // El cuerpo va por stdin: son las notas del changelog, y en la línea de
      // comandos de Windows las comillas y los saltos de línea no sobreviven.
      const r = run(
        ["pr", "create", "--base", base, "--head", head, "--title", title, "--body-file", "-"],
        body,
      );
      if (r.status !== 0) throw new StarError(`gh no pudo abrir el PR:\n${r.err}`);
      return r.out.split(/\r?\n/).pop() ?? "";
    },
    findPr(head) {
      const r = run([
        "pr",
        "list",
        "--head",
        head,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        "number,url,state,mergeable,statusCheckRollup",
      ]);
      if (r.status !== 0) throw new StarError(`gh no pudo buscar el PR de ${head}:\n${r.err}`);
      const [pr] = JSON.parse(r.out || "[]") as {
        number: number;
        url: string;
        state: PullRequest["state"];
        mergeable: string;
        statusCheckRollup: Rollup[] | null;
      }[];
      if (!pr) return null;
      return {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        checks: summarizeChecks(pr.statusCheckRollup ?? []),
        mergeable:
          pr.mergeable === "MERGEABLE" ? true : pr.mergeable === "CONFLICTING" ? false : null,
      };
    },
    mergeSquash(number, subject) {
      const r = run([
        "pr",
        "merge",
        String(number),
        "--squash",
        "--subject",
        subject,
        "--body",
        "",
      ]);
      if (r.status !== 0) throw new StarError(`gh no pudo mergear el PR #${number}:\n${r.err}`);
    },
  };
}
