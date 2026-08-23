/**
 * What the authorization-code flow has to carry across a full-page navigation:
 * the single-use state nonce and the PKCE verifier, stashed before the redirect
 * to Trakt and read back at `/auth/callback`.
 *
 * A port rather than `sessionStorage` because the semantics, not just the API,
 * are the browser's: per tab, and gone when the tab closes, which is exactly
 * what a single-use nonce wants and what makes an abandoned attempt expire on
 * its own. It is a required member of `AuthDeps`, so a target with no page
 * navigation states what it does instead of inheriting a default.
 */
export interface RedirectHandoff {
  read(): { readonly state: string; readonly verifier: string } | null;
  write(state: string, verifier: string): void;
  /** Called the moment the state is accepted: both values are single-use. */
  clear(): void;
}
