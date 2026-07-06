import { useAuth } from "@ui/auth/store";
import { usePrefs } from "@ui/prefs/prefs-store";
import { THRESHOLD_OPTIONS } from "@ui/prefs/threshold";
import { ThemeToggle } from "@ui/theme/ThemeToggle";
import { type ReactElement, useState } from "react";

/** "2 weeks" / "3 weeks" — every threshold option is a whole number of weeks. */
function weeksLabel(days: number): string {
  const weeks = days / 7;
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

/**
 * Settings → Preferences + Connections: the appearance toggle
 * (relocated here off the header/sidebar), the staleness threshold that splits
 * Watching from Not-watched-in-a-while, the connected token's status, and a
 * Disconnect that revokes on Trakt and clears the store, returning to onboarding.
 */
export function Settings(): ReactElement {
  const disconnect = useAuth((s) => s.disconnect);
  const thresholdDays = usePrefs((s) => s.thresholdDays);
  const setThresholdDays = usePrefs((s) => s.setThresholdDays);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  return (
    <section className="screen" data-testid="screen-settings">
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
            Not-watched-in-a-while after
            <small className="settings__hint">
              Shows you haven't touched for longer drop out of Up Next.
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
      <button
        type="button"
        className="button button--danger"
        data-testid="button-disconnect"
        disabled={disconnecting}
        onClick={() => {
          setDisconnecting(true);
          setDisconnectError(null);
          disconnect().catch(() => {
            // A successful disconnect unmounts this screen; only a failure lands
            // here, where the button must recover so the user can retry.
            setDisconnecting(false);
            setDisconnectError("Couldn't finish disconnecting. Please try again.");
          });
        }}
      >
        {disconnecting ? "Disconnecting…" : "Disconnect Trakt"}
      </button>
    </section>
  );
}
