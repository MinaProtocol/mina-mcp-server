import { AccountsManager, TestAccount } from "../graphql/accounts-manager.js";

export const STDIO_SESSION_ID = "stdio";

export interface SessionReleaseResult {
  released: number;
  errors: string[];
}

export class SessionTracker {
  private sessions = new Map<string, TestAccount[]>();

  constructor(private accountsManager: AccountsManager) {}

  trackAcquire(sessionId: string, account: TestAccount): void {
    const list = this.sessions.get(sessionId) ?? [];
    list.push(account);
    this.sessions.set(sessionId, list);
  }

  trackRelease(sessionId: string, pk: string): boolean {
    const list = this.sessions.get(sessionId);
    if (!list) return false;
    const idx = list.findIndex((a) => a.pk === pk);
    if (idx === -1) return false;
    list.splice(idx, 1);
    if (list.length === 0) this.sessions.delete(sessionId);
    return true;
  }

  getSessionAccounts(sessionId: string): TestAccount[] {
    return [...(this.sessions.get(sessionId) ?? [])];
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  async releaseSession(sessionId: string): Promise<SessionReleaseResult> {
    const list = this.sessions.get(sessionId);
    if (!list || list.length === 0) {
      this.sessions.delete(sessionId);
      return { released: 0, errors: [] };
    }
    const errors: string[] = [];
    let released = 0;
    for (const a of list) {
      try {
        await this.accountsManager.releaseAccount(a);
        released++;
      } catch (e) {
        errors.push(`${a.pk}: ${(e as Error).message}`);
      }
    }
    this.sessions.delete(sessionId);
    return { released, errors };
  }

  async releaseAll(): Promise<SessionReleaseResult> {
    const errors: string[] = [];
    let released = 0;
    for (const [, list] of this.sessions) {
      for (const a of list) {
        try {
          await this.accountsManager.releaseAccount(a);
          released++;
        } catch (e) {
          errors.push(`${a.pk}: ${(e as Error).message}`);
        }
      }
    }
    this.sessions.clear();
    return { released, errors };
  }
}
