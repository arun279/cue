import { Link } from "@tanstack/react-router";
import { useAuth } from "@ui/auth/store";
import { DetailBack } from "@ui/components/DetailBack";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { usePrefs } from "@ui/prefs/prefs-store";
import { THRESHOLD_OPTIONS } from "@ui/prefs/threshold";
import { ThemeToggle } from "@ui/theme/ThemeToggle";
import { AlertDialog } from "radix-ui";
import { type ReactElement, useState } from "react";

/** "2 weeks" / "3 weeks" — every threshold option is a whole number of weeks. */
function weeksLabel(days: number): string {
  const weeks = days / 7;
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

/**
 * Settings → Preferences + Connections: the appearance toggle
 * (relocated here off the header/sidebar), the threshold that decides when an
 * in-progress show collapses into Up Next's "Haven't watched in a while" drawer,
 * the connected token's status, and a
 * Disconnect that revokes on Trakt and clears the store, returning to onboarding.
 */
export function Settings(): ReactElement {
  useDocumentTitle("Settings · Cue");
  const disconnect = useAuth((s) => s.disconnect);
  const thresholdDays = usePrefs((s) => s.thresholdDays);
  const setThresholdDays = usePrefs((s) => s.setThresholdDays);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  return (
    <section className="screen" data-testid="screen-settings">
      <DetailBack
        testId="settings-back"
        label="‹ Back"
        fallback={
          <Link to="/profile" className="detail-back" data-testid="settings-back">
            ‹ Profile
          </Link>
        }
      />
      <h1 className="screen__title">Settings</h1>

      <h2 className="settings__heading">Appearance</h2>
      <dl className="settings__list">
        <div className="settings__row">
          <dt>Theme</dt>
          <dd>
            <ThemeToggle />
          </dd>
        </div>
      </dl>

      <h2 className="settings__heading">Preferences</h2>
      <dl className="settings__list">
        <div className="settings__row">
          <dt>
            Haven't watched in a while after
            <small className="settings__hint">
              Shows you haven't touched for longer collapse into the "Haven't watched in a while"
              drawer at the bottom of Up Next.
            </small>
          </dt>
          <dd>
            <label className="library-sort">
              <span className="library-sort__label">Inactivity</span>
              <select
                className="library-sort__select"
                data-testid="threshold-select"
                value={thresholdDays}
                onChange={(event) => setThresholdDays(Number(event.target.value))}
              >
                {THRESHOLD_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {weeksLabel(days)}
                  </option>
                ))}
              </select>
            </label>
          </dd>
        </div>
      </dl>

      <h2 className="settings__heading">Connections</h2>
      <dl className="settings__list">
        <div className="settings__row">
          <dt>Trakt</dt>
          <dd data-testid="connection-status">
            <span className="badge badge--ok">Connected</span>
          </dd>
        </div>
      </dl>

      <p className="settings__note">
        Disconnecting revokes this device's access to your Trakt account and signs you out of Cue.
      </p>
      {disconnectError !== null && (
        <p className="settings__error" role="alert" data-testid="disconnect-error">
          {disconnectError}
        </p>
      )}
      <AlertDialog.Root>
        <AlertDialog.Trigger asChild>
          <button
            type="button"
            className="button button--danger"
            data-testid="button-disconnect"
            disabled={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect Trakt"}
          </button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog__overlay" />
          <AlertDialog.Content
            className="dialog__content"
            data-testid="disconnect-dialog"
            aria-modal="true"
          >
            <AlertDialog.Title className="dialog__title">Disconnect Trakt?</AlertDialog.Title>
            <AlertDialog.Description className="dialog__body">
              Your watch history stays safe in your Trakt account — disconnecting only signs this
              device out of Cue. Reconnecting takes just a few seconds.
            </AlertDialog.Description>
            <div className="dialog__actions">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="button button--ghost"
                  data-testid="disconnect-cancel"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  className="button button--danger"
                  data-testid="button-disconnect-confirm"
                  onClick={() => {
                    setDisconnecting(true);
                    setDisconnectError(null);
                    disconnect().catch((error: unknown) => {
                      // A successful disconnect unmounts this screen; only a failure
                      // lands here, where the button must recover so the user can retry.
                      setDisconnecting(false);
                      // A refused disconnect (writes still queued offline) gets an
                      // honest, actionable message instead of the generic failure.
                      const pending = error instanceof Error && error.name === "PendingWritesError";
                      setDisconnectError(
                        pending
                          ? "Some changes haven't synced yet. Reconnect to the internet, then try disconnecting again."
                          : "Couldn't finish disconnecting. Please try again.",
                      );
                    });
                  }}
                >
                  Disconnect
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
