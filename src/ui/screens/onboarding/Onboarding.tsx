import { checkTraktCredentials } from "@data/auth/format";
import { TmdbClient } from "@data/tmdb/client";
import { useAuth } from "@ui/auth/store";
import { type FormEvent, type ReactElement, useState } from "react";

type FieldErrors = Partial<Record<"clientId" | "clientSecret" | "tmdbKey", string>>;

interface ValidationResult {
  readonly errors: FieldErrors;
  /** TMDB could not be reached to check the key — a retry condition, not a bad key. */
  readonly tmdbUnavailable: boolean;
}

async function validate(
  clientId: string,
  clientSecret: string,
  tmdbKey: string,
): Promise<ValidationResult> {
  const errors: FieldErrors = {};
  for (const error of checkTraktCredentials(clientId, clientSecret)) {
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

export function Onboarding(): ReactElement {
  const connectWithRedirect = useAuth((s) => s.connectWithRedirect);
  const connectWithDeviceCode = useAuth((s) => s.connectWithDeviceCode);
  const cancelConnect = useAuth((s) => s.cancelConnect);
  const connectStatus = useAuth((s) => s.connectStatus);
  const errorMessage = useAuth((s) => s.errorMessage);
  const deviceCode = useAuth((s) => s.deviceCode);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const busy = checking || connectStatus === "connecting";

  async function submit(
    connect: (creds: { clientId: string; clientSecret: string; tmdbKey: string }) => Promise<void>,
  ): Promise<void> {
    setChecking(true);
    let result: ValidationResult;
    try {
      result = await validate(clientId, clientSecret, tmdbKey);
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
    await connect({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      tmdbKey: tmdbKey.trim(),
    });
  }

  if (deviceCode !== null) {
    return (
      <main className="onboarding" data-testid="screen-onboarding">
        <section className="onboarding__card" aria-labelledby="device-heading">
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
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding" data-testid="screen-onboarding">
      <form
        className="onboarding__card"
        aria-labelledby="onboarding-heading"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void submit(connectWithRedirect);
        }}
      >
        <h1 className="onboarding__title" id="onboarding-heading">
          Connect Cue to Trakt
        </h1>
        <p className="onboarding__lead" data-testid="single-owner-copy">
          Cue has no server. This is a personal, single-owner app: enter the credentials from a
          Trakt application you registered yourself. Your Trakt client secret is stored on this
          device only and is not treated as a confidential client secret — you own the Trakt app it
          belongs to.
        </p>

        <Field
          id="client-id"
          label="Trakt client ID"
          value={clientId}
          onChange={setClientId}
          error={fieldErrors.clientId}
          autoComplete="off"
        />
        <Field
          id="client-secret"
          label="Trakt client secret"
          value={clientSecret}
          onChange={setClientSecret}
          error={fieldErrors.clientSecret}
          type="password"
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
      </form>
    </main>
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
