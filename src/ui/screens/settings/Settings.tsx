import { Link } from "@tanstack/react-router";
import { useAuth } from "@ui/auth/store";
import { DetailBack } from "@ui/components/DetailBack";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { usePrefs } from "@ui/prefs/prefs-store";
import { THRESHOLD_OPTIONS } from "@ui/prefs/threshold";
import { ThemeToggle } from "@ui/theme/ThemeToggle";
import { AlertDialog, Switch } from "radix-ui";
import { type ReactElement, useState } from "react";

/** Trakt account deletion lives on Trakt — Cue only hands the user off to it. */
const TRAKT_ACCOUNT_SETTINGS_URL = "https://app.trakt.tv/settings/advanced";

// The official Trakt logo is a required attribution asset that must ship
// UNALTERED, so it is not committed here — only its slot is. `import.meta.glob`
// resolves to `{}` while the file is absent (no build break) and picks it up
// automatically once dropped in, at which point the image below renders.
// TODO(trakt-logo): drop the unaltered official Trakt logo from
// app.trakt.tv/branding into src/ui/assets/trakt-logo.svg (use the dark asset;
// preserve its required clear-space). No other change is needed.
const traktLogoModules = import.meta.glob<{ readonly default: string }>(
  "../../assets/trakt-logo.svg",
  { eager: true },
);
const traktLogoSrc = Object.values(traktLogoModules)[0]?.default ?? null;

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
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  const setShowsEnabled = usePrefs((s) => s.setShowsEnabled);
  const setMoviesEnabled = usePrefs((s) => s.setMoviesEnabled);
  const hapticsEnabled = usePrefs((s) => s.hapticsEnabled);
  const setHapticsEnabled = usePrefs((s) => s.setHapticsEnabled);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  // The one enabled medium can't be turned off — the app is never emptied of both.
  const media = [
    { key: "shows", label: "TV shows", enabled: showsEnabled, setEnabled: setShowsEnabled },
    { key: "movies", label: "Movies", enabled: moviesEnabled, setEnabled: setMoviesEnabled },
  ] as const;
  const enabledCount = (showsEnabled ? 1 : 0) + (moviesEnabled ? 1 : 0);

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
        <div className="settings__row">
          <dt>
            Haptics
            <small className="settings__hint">
              A short buzz when you mark something watched or take it back. Applies on the phone
              app.
            </small>
          </dt>
          <dd>
            <Switch.Root
              className="switch"
              checked={hapticsEnabled}
              onCheckedChange={setHapticsEnabled}
              aria-label="Haptics"
              data-testid="haptics-toggle"
            >
              <Switch.Thumb className="switch__thumb" />
            </Switch.Root>
          </dd>
        </div>
      </dl>

      <h2 className="settings__heading">Content</h2>
      <dl className="settings__list" data-testid="content-section">
        {media.map((item) => {
          const isLastEnabled = item.enabled && enabledCount === 1;
          return (
            <div className="settings__row" key={item.key}>
              <dt>{item.label}</dt>
              <dd>
                <Switch.Root
                  className="switch"
                  checked={item.enabled}
                  disabled={isLastEnabled}
                  onCheckedChange={(checked) => item.setEnabled(checked)}
                  aria-label={item.label}
                  data-testid={`content-toggle-${item.key}`}
                >
                  <Switch.Thumb className="switch__thumb" />
                </Switch.Root>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="settings__note" data-testid="content-hint">
        Track TV shows, movies, or both. Turn off a medium and Cue hides it everywhere — Library,
        Search, and your history. At least one stays on.
      </p>

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
        Disconnecting revokes this device's access to your Trakt account, signs you out of Cue, and
        deletes everything Cue kept on this device — the local cache and your Trakt token. Your
        watch history stays in your Trakt account.
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
              Your watch history stays safe in your Trakt account. Disconnecting signs this device
              out of Cue and deletes the local cache and Trakt token stored on this device.
              Reconnecting takes just a few seconds.
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

      <div className="settings__handoff">
        <p className="settings__note">
          Only Trakt can delete your Trakt account. This opens Trakt in your browser to do it — Cue
          has no account of its own to delete.
        </p>
        <a
          className="button button--ghost"
          data-testid="link-delete-account"
          href={TRAKT_ACCOUNT_SETTINGS_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Delete your Trakt account
        </a>
      </div>

      <h2 className="settings__heading">About</h2>
      <dl className="settings__list">
        <div className="settings__row">
          <dt>Powered by Trakt</dt>
          <dd>
            {traktLogoSrc !== null && (
              <img className="settings__trakt-logo" src={traktLogoSrc} alt="Trakt" />
            )}
          </dd>
        </div>
      </dl>
      <p className="settings__note" data-testid="trakt-attribution">
        Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt.
      </p>
    </section>
  );
}
