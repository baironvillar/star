import { describe, expect, it } from "vite-plus/test";
import { summarizeChecks } from "./gh.ts";

describe("summarizeChecks", () => {
  it("sin checks es none", () => {
    expect(summarizeChecks([])).toBe("none");
  });

  it("todo completo y bien es passing, aunque haya skipped o neutral", () => {
    expect(
      summarizeChecks([
        { status: "COMPLETED", conclusion: "SUCCESS" },
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { status: "COMPLETED", conclusion: "NEUTRAL" },
        { state: "SUCCESS" },
      ]),
    ).toBe("passing");
  });

  it("algo corriendo es pending", () => {
    expect(
      summarizeChecks([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS" }]),
    ).toBe("pending");
    expect(summarizeChecks([{ state: "PENDING" }])).toBe("pending");
  });

  it("un fallo o un cancelado gana sobre todo lo demás", () => {
    expect(
      summarizeChecks([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }]),
    ).toBe("failing");
    expect(summarizeChecks([{ status: "COMPLETED", conclusion: "CANCELLED" }])).toBe("failing");
    expect(summarizeChecks([{ state: "ERROR" }])).toBe("failing");
  });
});
