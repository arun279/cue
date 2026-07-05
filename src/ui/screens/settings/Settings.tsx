import { useAuth } from "@ui/auth/store";
import { type ReactElement, useState } from "react";

/**
 * Settings → Connections: the connected token's status plus a
 * Disconnect that revokes on Trakt and clears the store, returning to
 * onboarding. Preferences/Data/About sections arrive later.
 */
export function Settings(): ReactElement {
  const tmdbConfigured = useAuth((s) => s.tmdbConfigured);
  const disconnect = useAuth((s) => s.disconnect);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  return (
    <section className="screen" data-testid="screen-settings">
      <h1 className="screen__title">Settings</h1>

      <h2 className="settings__heading">Connections</h2>
      <dl className="settings__list">
        <div className="settings__row">
          <dt>Trakt</dt>
          <dd data-testid="connection-status">
            <span className="badge badge--ok">Connected</span>
          </dd>
        </div>
        <div className="settings__row">
          <dt>TMDB</dt>
          <dd data-testid="tmdb-status">
            {tmdbConfigured ? (
              <span className="badge badge--ok">Key added</span>
            ) : (
              <span className="badge">Not configured</span>
            )}
          </dd>
        </div>
      </dl>

      <p className="settings__note">
        Disconnecting revokes this device's Trakt token and clears the credentials stored here.
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
