import { CueMark } from "@ui/app-shell/CueMark";
import { useAuth } from "@ui/auth/store";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { type ReactElement, type ReactNode, useState } from "react";
import heroLogin from "./assets/hero-login.webp";

/** Screening-room login backdrop: the hero art under a dark scrim so the card reads. */
const LOGIN_BACKDROP = {
  background: `linear-gradient(180deg, rgb(14 12 10 / 0.72), rgb(14 12 10 / 0.92)), url(${heroLogin}) center / cover no-repeat`,
} as const;

/** Shared screening-room chrome: hero backdrop + a centered brand-marked card. */
function OnboardingShell(props: { children: ReactNode; labelledBy: string }): ReactElement {
  return (
    <main className="onboarding" data-testid="screen-onboarding" style={LOGIN_BACKDROP}>
      <section className="onboarding__card" aria-labelledby={props.labelledBy}>
        <div className="onboarding__brand">
          <CueMark className="onboarding__mark" />
          <span className="onboarding__wordmark">Cue</span>
        </div>
        {props.children}
      </section>
    </main>
  );
}

export function Onboarding(): ReactElement {
  useDocumentTitle("Sign in · Cue");
  const connectWithRedirect = useAuth((s) => s.connectWithRedirect);
  const connectWithDeviceCode = useAuth((s) => s.connectWithDeviceCode);
  const cancelConnect = useAuth((s) => s.cancelConnect);
  const connectStatus = useAuth((s) => s.connectStatus);
  const errorMessage = useAuth((s) => s.errorMessage);
  const deviceCode = useAuth((s) => s.deviceCode);
  const native = useAuth((s) => s.native);

  const busy = connectStatus === "connecting";
  // On native the redirect can't return (the app origin is capacitor://localhost),
  // so device-code is the primary path there; on web the full-page redirect is.
  const startPrimary = native ? connectWithDeviceCode : connectWithRedirect;

  if (deviceCode !== null) {
    return (
      <OnboardingShell labelledBy="device-heading">
        <h1 className="onboarding__title" id="device-heading">
          Enter this code on Trakt
        </h1>
        <p className="onboarding__lead">
          Open the page below on any device and enter this code to connect Cue to your Trakt
          account.
        </p>
        <p className="device-code" data-testid="device-user-code">
          {deviceCode.userCode}
        </p>
        <CopyCode code={deviceCode.userCode} />
        <a
          className="button"
          href={deviceCode.verificationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Trakt to enter it
        </a>
        <p className="onboarding__hint" role="status" data-testid="device-status">
          Waiting for you to approve in Trakt…
        </p>
        <button type="button" className="button button--ghost" onClick={cancelConnect}>
          Cancel
        </button>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell labelledBy="onboarding-heading">
      <h1 className="onboarding__title" id="onboarding-heading">
        Welcome to Cue
      </h1>
      <p className="onboarding__lead">
        Your Up Next queue, library, and stats, kept in sync with your own Trakt account.
      </p>

      {errorMessage !== null && (
        <p className="onboarding__error" role="alert" data-testid="connect-error">
          {errorMessage}
        </p>
      )}

      <div className="onboarding__actions">
        <button
          type="button"
          className="button"
          data-testid="button-connect"
          disabled={busy}
          onClick={() => void startPrimary()}
        >
          {busy ? "Connecting…" : "Continue with Trakt"}
        </button>
        {!native && (
          <button
            type="button"
            className="onboarding__alt"
            data-testid="button-device-code"
            disabled={busy}
            onClick={() => void connectWithDeviceCode()}
          >
            Trouble connecting? Enter a code instead
          </button>
        )}
      </div>

      <p className="onboarding__fine-print">
        Cue has no account or server of its own. Your watch history stays in your Trakt account;
        everything else lives only on this device.
      </p>
    </OnboardingShell>
  );
}

/** Copy the device user code so it need not be retyped on the other device (recognition over recall). */
function CopyCode({ code }: { code: string }): ReactElement {
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
      className="button button--ghost button--sm"
      data-testid="button-copy-code"
      onClick={() => void copy()}
    >
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}
