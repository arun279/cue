import type { RedirectHandoff } from "@cue/core/ports/redirect-handoff";

const STATE_KEY = "cue.oauth.state";
// The PKCE verifier is stashed alongside the state nonce so it survives the
// full-page redirect to Trakt and back to `/auth/callback` for the exchange.
const VERIFIER_KEY = "cue.oauth.verifier";

/** `RedirectHandoff` over `sessionStorage`: per tab, and gone when it closes. */
export const sessionRedirectHandoff: RedirectHandoff = {
  read() {
    const state = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    return state === null || verifier === null ? null : { state, verifier };
  },
  write(state, verifier) {
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
  },
  clear() {
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
  },
};
