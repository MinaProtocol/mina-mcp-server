import { describe, it, expect } from "vitest";
import { ResetController } from "../../src/reset/controller.js";

describe("ResetController", () => {
  it("starts unfrozen", () => {
    const c = new ResetController(() => 1_000);
    expect(c.isFrozen()).toBe(false);
    expect(c.getStatus()).toEqual({ frozen: false, frozenUntil: null, remainingMs: null });
  });

  it("freeze sets a deadline based on the injected clock", () => {
    let now = 1_000;
    const c = new ResetController(() => now);

    const status = c.freeze(60_000);
    expect(status.frozen).toBe(true);
    expect(status.frozenUntil).toBe(61_000);
    expect(status.remainingMs).toBe(60_000);
    expect(c.isFrozen()).toBe(true);
  });

  it("freeze auto-expires once the deadline is reached", () => {
    let now = 1_000;
    const c = new ResetController(() => now);

    c.freeze(60_000);
    now = 30_000;
    expect(c.isFrozen()).toBe(true);

    now = 61_001;
    expect(c.isFrozen()).toBe(false);
    expect(c.getStatus()).toEqual({ frozen: false, frozenUntil: null, remainingMs: null });
  });

  it("freeze with 0 or negative duration clears any active freeze", () => {
    let now = 1_000;
    const c = new ResetController(() => now);

    c.freeze(60_000);
    expect(c.isFrozen()).toBe(true);

    const status = c.freeze(0);
    expect(status.frozen).toBe(false);
    expect(c.isFrozen()).toBe(false);
  });

  it("unfreeze clears any active freeze", () => {
    let now = 1_000;
    const c = new ResetController(() => now);

    c.freeze(60_000);
    expect(c.isFrozen()).toBe(true);

    const status = c.unfreeze();
    expect(status).toEqual({ frozen: false, frozenUntil: null, remainingMs: null });
    expect(c.isFrozen()).toBe(false);
  });

  it("freeze can be extended by re-calling freeze", () => {
    let now = 1_000;
    const c = new ResetController(() => now);

    c.freeze(60_000);
    now = 30_000;
    const status = c.freeze(120_000);
    expect(status.frozenUntil).toBe(150_000);
    expect(status.remainingMs).toBe(120_000);
  });

  it("getStatus reflects remaining time as the clock advances", () => {
    let now = 1_000;
    const c = new ResetController(() => now);

    c.freeze(60_000);
    now = 31_000;
    const status = c.getStatus();
    expect(status.frozen).toBe(true);
    expect(status.remainingMs).toBe(30_000);
  });
});
