/**
 * Client for the Mina Accounts Manager REST API (port 8181).
 * Manages pre-funded test accounts from the genesis ledger.
 * Each account has 1550 MINA, password: "naughty blue worm"
 */

export interface TestAccount {
  pk: string;
  sk: string;
}

export class AccountsManager {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl =
      baseUrl ?? process.env.ACCOUNTS_MANAGER_ENDPOINT ?? "http://localhost:8181";
  }

  async acquireAccount(opts?: {
    isRegularAccount?: boolean;
    unlockAccount?: boolean;
  }): Promise<TestAccount> {
    const params = new URLSearchParams();
    if (opts?.isRegularAccount !== undefined) {
      params.set("isRegularAccount", String(opts.isRegularAccount));
    }
    if (opts?.unlockAccount !== undefined) {
      params.set("unlockAccount", String(opts.unlockAccount));
    }
    const qs = params.toString();
    const url = `${this.baseUrl}/acquire-account${qs ? `?${qs}` : ""}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to acquire account: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as TestAccount;
  }

  async releaseAccount(account: TestAccount): Promise<void> {
    const response = await fetch(`${this.baseUrl}/release-account`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    if (!response.ok) {
      throw new Error(`Failed to release account: ${response.status} ${await response.text()}`);
    }
  }

  async listAcquiredAccounts(): Promise<TestAccount[]> {
    const response = await fetch(`${this.baseUrl}/list-acquired-accounts`);
    if (!response.ok) {
      throw new Error(`Failed to list accounts: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as TestAccount[];
  }

  async unlockAccount(account: TestAccount): Promise<void> {
    const response = await fetch(`${this.baseUrl}/unlock-account`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    if (!response.ok) {
      throw new Error(`Failed to unlock account: ${response.status} ${await response.text()}`);
    }
  }

  async lockAccount(account: TestAccount): Promise<void> {
    const response = await fetch(`${this.baseUrl}/lock-account`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    if (!response.ok) {
      throw new Error(`Failed to lock account: ${response.status} ${await response.text()}`);
    }
  }

  async isConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/list-acquired-accounts`);
      return response.ok;
    } catch {
      return false;
    }
  }

  getEndpoint(): string {
    return this.baseUrl;
  }
}
