import { describe, it, expect } from "vitest";
import { EXAMPLES, getExample, listExamples } from "../../src/examples/library.js";

describe("example library", () => {
  it("every example has a non-empty step list", () => {
    for (const e of EXAMPLES) {
      expect(e.steps.length).toBeGreaterThan(0);
      for (const s of e.steps) {
        expect(typeof s.tool).toBe("string");
        expect(s.tool.length).toBeGreaterThan(0);
      }
    }
  });

  it("example names are unique", () => {
    const names = EXAMPLES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("listExamples('snapshot') only returns snapshot or both", () => {
    const result = listExamples("snapshot");
    expect(result.length).toBeGreaterThan(0);
    for (const e of result) expect(["snapshot", "both"]).toContain(e.mode);
    expect(result.some((e) => e.mode === "tutorial")).toBe(false);
  });

  it("listExamples('tutorial') returns tutorial or both", () => {
    const result = listExamples("tutorial");
    expect(result.length).toBeGreaterThan(0);
    for (const e of result) expect(["tutorial", "both"]).toContain(e.mode);
    expect(result.some((e) => e.mode === "snapshot")).toBe(false);
  });

  it("getExample returns the matching workflow", () => {
    const e = getExample("send_payment");
    expect(e).not.toBeNull();
    expect(e!.name).toBe("send_payment");
    expect(e!.steps.some((s) => s.tool === "send_payment")).toBe(true);
  });

  it("getExample returns null for unknown names", () => {
    expect(getExample("not_a_real_example")).toBeNull();
  });
});
