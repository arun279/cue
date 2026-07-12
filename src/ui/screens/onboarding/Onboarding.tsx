import { CueMark } from "@ui/app-shell/CueMark";
import { useAuth } from "@ui/auth/store";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { type ReactElement, type ReactNode, useState } from "react";

const TRAKT_URL = "https://trakt.tv";

/** Which connect path the user started, so the waiting copy matches it (the
 * store only says "connecting", not which grant is in flight). */
type StartedPath = "redirect" | "device";

function Shell({
  children,
  labelledBy,
}: {
  children: ReactNode;
  labelledBy: string;
}): ReactElement {
  return (
    <main className="onb" data-testid="screen-onboarding">
      <section className="onb__card" aria-labelledby={labelledBy}>
        {children}
      </section>
    </main>
  );
}

function Spinner(): ReactElement {
  return <span className="onb__spinner" aria-hidden="true" />;
}

/** Copy the device code with a tap so it need not be retyped on the other
 * device (recognition over recall); the whole card is the target. */
function CodeCard({ code }: { code: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions/insecure context): the code is still
      // visible above to type by hand, so there's nothing to recover.
    }
  }

  return (
    <button
      type="button"
      className="onb__code"
      data-testid="button-copy-code"
      onClick={() => void copy()}
    >
      <span className="onb__code-text" data-testid="device-user-code">
        {code}
      </span>
      <span className="onb__code-hint">{copied ? "Copied" : "Tap to copy"}</span>
    </button>
  );
}

/**
 * Onboarding: one welcome beat, then the Trakt hand-off. Web connects through
 * the full-page PKCE redirect; native (where the redirect can't return; the
 * app origin is capacitor://localhost) runs the device-code grant with a
 * copy-on-tap code and a live polling state. The auth store owns every
 * transition; this screen only dresses it.
 */
export function Onboarding(): ReactElement {
  useDocumentTitle("Sign in · Cue");
  const connectWithRedirect = useAuth((s) => s.connectWithRedirect);
  const connectWithDeviceCode = useAuth((s) => s.connectWithDeviceCode);
  const cancelConnect = useAuth((s) => s.cancelConnect);
  const connectStatus = useAuth((s) => s.connectStatus);
  const errorMessage = useAuth((s) => s.errorMessage);
  const deviceCode = useAuth((s) => s.deviceCode);
  const native = useAuth((s) => s.native);
  const [started, setStarted] = useState<StartedPath | null>(null);

  const busy = connectStatus === "connecting";

  if (deviceCode !== null) {
    return (
      <Shell labelledBy="device-heading">
        <h1 className="onb__title" id="device-heading">
          Enter this code on Trakt
        </h1>
        <CodeCard code={deviceCode.userCode} />
        <p className="onb__lead">
          Enter it at{" "}
          <a
            className="onb__link"
            href={deviceCode.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            trakt.tv/activate
          </a>
        </p>
        <p className="onb__status" role="status" data-testid="device-status">
          <Spinner />
          Waiting for you to approve in Trakt…
        </p>
        <button type="button" className="onb__alt" onClick={cancelConnect}>
          Cancel
        </button>
      </Shell>
    );
  }

  return (
    <Shell labelledBy="onboarding-heading">
      <div className="onb__brand">
        <CueMark className="onb__mark" />
        <h1 className="onb__wordmark" id="onboarding-heading">
          Cue
        </h1>
      </div>
      <p className="onb__tagline">Your shows. One tap ahead.</p>

      {errorMessage !== null && (
        <p className="onb__error" role="alert" data-testid="connect-error">
          {errorMessage}
        </p>
      )}

      {busy && started === "redirect" ? (
        <p className="onb__status" role="status" data-testid="redirect-status">
          <Spinner />
          Continuing to Trakt…
        </p>
      ) : (
        <div className="onb__actions">
          <button
            type="button"
            className="onb__cta"
            data-testid="button-connect"
            disabled={busy}
            onClick={() => {
              if (native) {
                setStarted("device");
                void connectWithDeviceCode();
              } else {
                setStarted("redirect");
                void connectWithRedirect();
              }
            }}
          >
            {busy ? "Connecting…" : "Connect Trakt"}
          </button>
          {!native && (
            <button
              type="button"
              className="onb__alt"
              data-testid="button-device-code"
              disabled={busy}
              onClick={() => {
                setStarted("device");
                void connectWithDeviceCode();
              }}
            >
              Trouble connecting? Enter a code instead
            </button>
          )}
        </div>
      )}

      <p className="onb__foot">
        Powered by Trakt. Your data lives in your Trakt account.{" "}
        <a className="onb__link" href={TRAKT_URL} target="_blank" rel="noopener noreferrer">
          What's Trakt?
        </a>
      </p>
    </Shell>
  );
}
