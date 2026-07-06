import { checkTraktCredentials } from "@data/auth/format";
import { TmdbClient } from "@data/tmdb/client";
import { CueMark } from "@ui/app-shell/CueMark";
import { useAuth } from "@ui/auth/store";
import { type FormEvent, type ReactElement, type ReactNode, useState } from "react";
import heroLogin from "./assets/hero-login.webp";

/** Screening-room login backdrop: the hero art under a dark scrim so the card + fields read. */
const LOGIN_BACKDROP = {
  background: `linear-gradient(180deg, rgb(14 12 10 / 0.72), rgb(14 12 10 / 0.92)), url(${heroLogin}) center / cover no-repeat`,
} as const;

type FieldErrors = Partial<Record<"clientId" | "tmdbKey", string>>;

interface ValidationResult {
  readonly errors: FieldErrors;
  /** TMDB could not be reached to check the key — a retry condition, not a bad key. */
  readonly tmdbUnavailable: boolean;
}

async function validate(clientId: string, tmdbKey: string): Promise<ValidationResult> {
  const errors: FieldErrors = {};
  for (const error of checkTraktCredentials(clientId)) {
    errors[error.field] = error.message;
  }
  const key = tmdbKey.trim();
  if (key.length === 0) return { errors, tmdbUnavailable: false };
  const status = await new TmdbClient({ credential: key }).validate();
  if (status === "invalid") {
    errors.tmdbKey = "That TMDB key was rejected. Check it or leave it blank.";
  }
  return { errors, tmdbUnavailable: status === "unavailable" };
}

/** Shared screening-room chrome: hero backdrop + a centered brand-marked card. */
function OnboardingShell(props: {
  children: ReactNode;
  labelledBy: string;
  as?: "form" | "section";
  onSubmit?: (event: FormEvent) => void;
}): ReactElement {
  const Card = props.as ?? "section";
  return (
    <main className="onboarding" data-testid="screen-onboarding" style={LOGIN_BACKDROP}>
      <Card
        className="onboarding__card"
        aria-labelledby={props.labelledBy}
        onSubmit={props.onSubmit}
      >
        <div className="onboarding__brand">
          <CueMark className="onboarding__mark" />
          <span className="onboarding__wordmark">Cue</span>
        </div>
        {props.children}
      </Card>
    </main>
  );
}

export function Onboarding(): ReactElement {
  const connectWithRedirect = useAuth((s) => s.connectWithRedirect);
  const connectWithDeviceCode = useAuth((s) => s.connectWithDeviceCode);
  const cancelConnect = useAuth((s) => s.cancelConnect);
  const connectStatus = useAuth((s) => s.connectStatus);
  const errorMessage = useAuth((s) => s.errorMessage);
  const deviceCode = useAuth((s) => s.deviceCode);

  const [clientId, setClientId] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const busy = checking || connectStatus === "connecting";

  async function submit(
    connect: (creds: { clientId: string; tmdbKey: string }) => Promise<void>,
  ): Promise<void> {
    setChecking(true);
    let result: ValidationResult;
    try {
      result = await validate(clientId, tmdbKey);
    } finally {
      setChecking(false);
    }
    setFieldErrors(result.errors);
    if (result.tmdbUnavailable) {
      setFormError("Couldn't reach TMDB to check that key. Try again, or leave it blank for now.");
      return;
    }
    setFormError(null);
    if (Object.keys(result.errors).length > 0) return;
    await connect({ clientId: clientId.trim(), tmdbKey: tmdbKey.trim() });
  }

  if (deviceCode !== null) {
    return (
      <OnboardingShell labelledBy="device-heading">
        <h1 className="onboarding__title" id="device-heading">
          Enter this code on Trakt
        </h1>
        <p className="onboarding__lead">
          Open the activation page and type the code below to connect this device.
        </p>
        <p className="device-code" data-testid="device-user-code">
          {deviceCode.userCode}
        </p>
        <a
          className="button"
          href={deviceCode.verificationUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open trakt.tv/activate
        </a>
        <p className="onboarding__hint" role="status" data-testid="device-status">
          Waiting for you to approve on Trakt…
        </p>
        <button type="button" className="button button--ghost" onClick={cancelConnect}>
          Cancel
        </button>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      as="form"
      labelledBy="onboarding-heading"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit(connectWithRedirect);
      }}
    >
      <h1 className="onboarding__title" id="onboarding-heading">
        Connect Cue to Trakt
      </h1>
      <p className="onboarding__lead" data-testid="connect-explainer">
        Cue has no server of its own — it talks directly to Trakt from this browser. Paste the
        client ID from a Trakt app you registered. No Trakt client secret is needed; Cue stores the
        client ID, your OAuth tokens, and the optional TMDB key locally in this browser.
      </p>

      <CallbackUrl />

      <Field
        id="client-id"
        label="Trakt client ID"
        hint="Found under your app at trakt.tv/oauth/applications."
        value={clientId}
        onChange={setClientId}
        error={fieldErrors.clientId}
        autoComplete="off"
      />
      <Field
        id="tmdb-key"
        label="TMDB key (optional)"
        hint="Adds higher-res artwork. Leave blank to use Trakt images only."
        value={tmdbKey}
        onChange={setTmdbKey}
        error={fieldErrors.tmdbKey}
        type="password"
        autoComplete="off"
      />

      {formError !== null && (
        <p className="onboarding__error" role="alert" data-testid="tmdb-unavailable">
          {formError}
        </p>
      )}

      {errorMessage !== null && (
        <p className="onboarding__error" role="alert" data-testid="connect-error">
          {errorMessage}
        </p>
      )}

      <div className="onboarding__actions">
        <button type="submit" className="button" data-testid="button-connect" disabled={busy}>
          {busy ? "Connecting…" : "Connect with Trakt"}
        </button>
        <button
          type="button"
          className="button button--ghost"
          data-testid="button-device-code"
          disabled={busy}
          onClick={() => void submit(connectWithDeviceCode)}
        >
          Use a device code instead
        </button>
      </div>
    </OnboardingShell>
  );
}

/**
 * The exact OAuth redirect URI Trakt must have registered. A mismatch is the
 * most common auth-code/PKCE failure and surfaces as a generic error, so we show
 * it plainly with a copy affordance and a note to add it to the Trakt app.
 */
function CallbackUrl(): ReactElement {
  const url = `${globalThis.location.origin}/auth/callback`;
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions/insecure context): the URL is still
      // visible to copy by hand, so there's nothing to recover.
    }
  }

  return (
    <div className="callback-url">
      <span className="callback-url__label">Redirect URI — add this to your Trakt app</span>
      <div className="callback-url__row">
        <code className="callback-url__value" data-testid="callback-url">
          {url}
        </code>
        <button
          type="button"
          className="button button--ghost button--sm"
          data-testid="button-copy-callback"
          onClick={() => void copy()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type,
  autoComplete,
}: FieldProps): ReactElement {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter((v) => v !== undefined).join(" ") || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint !== undefined && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <input
        className="field__input"
        id={id}
        data-testid={`input-${id}`}
        type={type ?? "text"}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== undefined && (
        <p className="field__error" id={errorId} data-testid={`error-${id}`}>
          {error}
        </p>
      )}
    </div>
  );
}
