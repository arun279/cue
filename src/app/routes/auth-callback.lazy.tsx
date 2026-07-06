import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@ui/auth/store";
import { type ReactElement, useEffect, useRef } from "react";

/**
 * OAuth auth-code return: validate the `state` nonce, exchange
 * the `code` for a token, then route to Up Next. A mismatched/absent state or a
 * failed exchange surfaces inline with a path back to sign-in.
 */
function AuthCallbackScreen(): ReactElement {
  const navigate = useNavigate();
  const completeRedirect = useAuth((s) => s.completeRedirect);
  const connectStatus = useAuth((s) => s.connectStatus);
  const errorMessage = useAuth((s) => s.errorMessage);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(globalThis.location.search);
    void completeRedirect(params.get("code"), params.get("state"));
  }, [completeRedirect]);

  useEffect(() => {
    if (connectStatus === "success") void navigate({ to: "/" });
  }, [connectStatus, navigate]);

  return (
    <main className="onboarding" data-testid="screen-auth-callback">
      <section className="onboarding__card">
        {connectStatus === "error" ? (
          <>
            <h1 className="onboarding__title">Connecting didn't finish</h1>
            <p className="onboarding__error" role="alert" data-testid="callback-error">
              {errorMessage}
            </p>
            <button
              type="button"
              className="button"
              data-testid="callback-retry"
              onClick={() => void navigate({ to: "/" })}
            >
              Back to start
            </button>
          </>
        ) : (
          <>
            <h1 className="onboarding__title">Finishing up…</h1>
            <p className="onboarding__lead" role="status">
              Connecting Cue to your Trakt account.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

export const Route = createLazyRoute("/auth/callback")({ component: AuthCallbackScreen });
