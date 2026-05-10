import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";
import { SessionTracker, STDIO_SESSION_ID } from "../../src/session/tracker.js";

describe("SessionTracker", () => {
  let mgr: AccountsManager;
  let tracker: SessionTracker;
  let releaseSpy: ReturnType<typeof vi.fn>;

  const a1 = { pk: "B62qa1", sk: "EKa1" };
  const a2 = { pk: "B62qa2", sk: "EKa2" };
  const a3 = { pk: "B62qa3", sk: "EKa3" };

  beforeEach(() => {
    releaseSpy = vi.fn().mockResolvedValue(undefined);
    mgr = new AccountsManager("http://test:8181");
    mgr.releaseAccount = releaseSpy;
    tracker = new SessionTracker(mgr);
  });

  it("tracks acquired accounts per session", () => {
    tracker.trackAcquire("s1", a1);
    tracker.trackAcquire("s1", a2);
    tracker.trackAcquire("s2", a3);

    expect(tracker.getSessionAccounts("s1").map((a) => a.pk).sort()).toEqual(["B62qa1", "B62qa2"]);
    expect(tracker.getSessionAccounts("s2").map((a) => a.pk)).toEqual(["B62qa3"]);
    expect(tracker.sessionIds().sort()).toEqual(["s1", "s2"]);
  });

  it("untracks a single account by pk", () => {
    tracker.trackAcquire("s1", a1);
    tracker.trackAcquire("s1", a2);

    expect(tracker.trackRelease("s1", a1.pk)).toBe(true);
    expect(tracker.getSessionAccounts("s1").map((a) => a.pk)).toEqual(["B62qa2"]);

    expect(tracker.trackRelease("s1", "unknown")).toBe(false);
    expect(tracker.trackRelease("missing-session", a1.pk)).toBe(false);
  });

  it("removes the session entry when last account is untracked", () => {
    tracker.trackAcquire("s1", a1);
    tracker.trackRelease("s1", a1.pk);
    expect(tracker.sessionIds()).toEqual([]);
  });

  it("releaseSession releases tracked accounts and forgets the session", async () => {
    tracker.trackAcquire("s1", a1);
    tracker.trackAcquire("s1", a2);
    tracker.trackAcquire("s2", a3);

    const result = await tracker.releaseSession("s1");
    expect(result).toEqual({ released: 2, errors: [] });
    expect(releaseSpy).toHaveBeenCalledTimes(2);
    expect(releaseSpy).toHaveBeenCalledWith(a1);
    expect(releaseSpy).toHaveBeenCalledWith(a2);
    expect(tracker.sessionIds()).toEqual(["s2"]);
  });

  it("releaseSession on unknown session is a no-op", async () => {
    const result = await tracker.releaseSession("ghost");
    expect(result).toEqual({ released: 0, errors: [] });
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("releaseSession captures partial failures and still forgets the session", async () => {
    releaseSpy
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("502 Bad Gateway"));

    tracker.trackAcquire("s1", a1);
    tracker.trackAcquire("s1", a2);

    const result = await tracker.releaseSession("s1");
    expect(result.released).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("B62qa2");
    expect(result.errors[0]).toContain("502 Bad Gateway");
    expect(tracker.sessionIds()).toEqual([]);
  });

  it("releaseAll drains every session", async () => {
    tracker.trackAcquire("s1", a1);
    tracker.trackAcquire("s2", a2);
    tracker.trackAcquire("s2", a3);

    const result = await tracker.releaseAll();
    expect(result).toEqual({ released: 3, errors: [] });
    expect(releaseSpy).toHaveBeenCalledTimes(3);
    expect(tracker.sessionIds()).toEqual([]);
  });

  it("STDIO_SESSION_ID is a stable constant", () => {
    expect(STDIO_SESSION_ID).toBe("stdio");
  });
});
