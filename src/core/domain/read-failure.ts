export interface DecodeIssue {
  readonly path: string;
  readonly message: string;
}

export type TraktFailure =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "not-found" }
  | { readonly kind: "account-limit" }
  | { readonly kind: "account-locked" }
  | { readonly kind: "vip-required" }
  | { readonly kind: "rate-limited"; readonly retryAfterMs: number | null }
  | { readonly kind: "unexpected-shape"; readonly issues: readonly DecodeIssue[] }
  | { readonly kind: "no-content" }
  | { readonly kind: "server"; readonly status: number }
  | { readonly kind: "timeout" }
  | { readonly kind: "network" };

export type ReadProblem =
  | TraktFailure
  | { readonly kind: "skipped-fields"; readonly issues: readonly DecodeIssue[] };

export class TraktReadError extends Error {
  readonly failure: TraktFailure;

  constructor(failure: TraktFailure, what: string) {
    const detail = failure.kind === "unexpected-shape" ? ` at ${failure.issues[0]?.path}` : "";
    super(`Failed to load ${what} (${failure.kind}${detail})`);
    this.name = "TraktReadError";
    this.failure = failure;
  }
}

export function healsOnRetry(failure: TraktFailure): boolean {
  if (failure.kind === "network" || failure.kind === "timeout") return true;
  return failure.kind === "server" && failure.status >= 500;
}
