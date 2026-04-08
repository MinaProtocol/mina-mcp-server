import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AccountsManager } from "../../src/graphql/accounts-manager.js";

describe("AccountsManager", () => {
  let mgr: AccountsManager;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mgr = new AccountsManager("http://test:8181");
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("should create with default endpoint", () => {
    const defaultMgr = new AccountsManager();
    expect(defaultMgr.getEndpoint()).toBe("http://localhost:8181");
  });

  it("should acquire a regular account", async () => {
    const mockAccount = { pk: "B62qtest123", sk: "EKEtest123" };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockAccount), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const account = await mgr.acquireAccount({ isRegularAccount: true });
    expect(account.pk).toBe("B62qtest123");
    expect(account.sk).toBe("EKEtest123");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/acquire-account");
    expect(url).toContain("isRegularAccount=true");
  });

  it("should acquire a zkApp account", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ pk: "B62qzkapp", sk: "EKEzkapp" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const account = await mgr.acquireAccount({ isRegularAccount: false });
    expect(account.pk).toBe("B62qzkapp");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("isRegularAccount=false");
  });

  it("should throw on acquire failure", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("No accounts available", { status: 503 }));
    await expect(mgr.acquireAccount()).rejects.toThrow("Failed to acquire account: 503");
  });

  it("should release an account", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("OK", { status: 200 }));

    await mgr.releaseAccount({ pk: "B62qtest", sk: "EKEtest" });

    expect(fetchSpy).toHaveBeenCalledWith("http://test:8181/release-account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pk: "B62qtest", sk: "EKEtest" }),
    });
  });

  it("should throw on release failure", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    await expect(mgr.releaseAccount({ pk: "B62q", sk: "EKE" })).rejects.toThrow("Failed to release account: 404");
  });

  it("should list acquired accounts", async () => {
    const mockAccounts = [
      { pk: "B62q1", sk: "EKE1" },
      { pk: "B62q2", sk: "EKE2" },
    ];
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockAccounts), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const accounts = await mgr.listAcquiredAccounts();
    expect(accounts).toHaveLength(2);
  });

  it("should unlock an account", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("OK", { status: 200 }));
    await mgr.unlockAccount({ pk: "B62qtest", sk: "EKEtest" });

    expect(fetchSpy).toHaveBeenCalledWith("http://test:8181/unlock-account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pk: "B62qtest", sk: "EKEtest" }),
    });
  });

  it("should lock an account", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("OK", { status: 200 }));
    await mgr.lockAccount({ pk: "B62qtest", sk: "EKEtest" });

    expect(fetchSpy).toHaveBeenCalledWith("http://test:8181/lock-account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pk: "B62qtest", sk: "EKEtest" }),
    });
  });

  it("should check connection (success)", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("[]", { status: 200 }));
    expect(await mgr.isConnected()).toBe(true);
  });

  it("should check connection (failure)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await mgr.isConnected()).toBe(false);
  });
});
