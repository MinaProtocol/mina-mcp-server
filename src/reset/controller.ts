export interface ResetStatus {
  frozen: boolean;
  frozenUntil: number | null;
  remainingMs: number | null;
}

export class ResetController {
  private frozenUntil: number | null = null;

  constructor(private now: () => number = () => Date.now()) {}

  freeze(durationMs: number): ResetStatus {
    if (durationMs <= 0) {
      this.frozenUntil = null;
    } else {
      this.frozenUntil = this.now() + durationMs;
    }
    return this.getStatus();
  }

  unfreeze(): ResetStatus {
    this.frozenUntil = null;
    return this.getStatus();
  }

  isFrozen(): boolean {
    if (this.frozenUntil === null) return false;
    if (this.now() >= this.frozenUntil) {
      this.frozenUntil = null;
      return false;
    }
    return true;
  }

  getStatus(): ResetStatus {
    const frozen = this.isFrozen();
    if (!frozen || this.frozenUntil === null) {
      return { frozen: false, frozenUntil: null, remainingMs: null };
    }
    return {
      frozen: true,
      frozenUntil: this.frozenUntil,
      remainingMs: this.frozenUntil - this.now(),
    };
  }
}
