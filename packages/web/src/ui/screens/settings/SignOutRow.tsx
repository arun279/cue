import { useAuth } from "@cue/core/auth/store";
import { ConfirmSheet } from "@ui/components/ConfirmSheet";
import { type ReactElement, useState } from "react";

/**
 * The one sign-out affordance, shared by Profile and Settings: a danger row that
 * confirms through the standard sheet, then runs the existing disconnect flow
 * (revoke on Trakt, clear this device's cache and token, back to onboarding).
 * A successful disconnect unmounts the row; only a failure lands back here,
 * where the button recovers so the user can retry. A refused disconnect (writes
 * still queued offline) gets an honest, actionable message instead of the
 * generic failure. Those queued marks must not be silently lost.
 */
export function SignOutRow(): ReactElement {
  const disconnect = useAuth((s) => s.disconnect);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = (): void => {
    setBusy(true);
    setError(null);
    disconnect().catch((cause: unknown) => {
      setBusy(false);
      const pending = cause instanceof Error && cause.name === "PendingWritesError";
      setError(
        pending
          ? "Some changes haven't synced yet. Reconnect to the internet, then try signing out again."
          : "Couldn't finish signing out. Please try again.",
      );
    });
  };

  return (
    <>
      {error !== null && (
        <p className="setting-error" role="alert" data-testid="disconnect-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="setting-row setting-row--danger"
        data-testid="button-disconnect"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        title="Sign out of Cue?"
        body="Your Trakt history stays on Trakt."
        primary={{
          label: "Sign out",
          danger: true,
          testId: "button-disconnect-confirm",
          onPress: signOut,
        }}
      />
    </>
  );
}
