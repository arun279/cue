// @vitest-environment jsdom
import { type AlertsMute, useAlertsMute } from "@cue/core/hooks/useAlertsMute";
import { createPrefsStore, PrefsProvider } from "@cue/core/prefs/prefs-store";
import { dismissSnack, snackText, useSnackbar } from "@cue/core/stores/snackbar-store";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeStorage } from "../prefs/_storage";
import { mountAsync } from "./_mount";

afterEach(dismissSnack);

const snack = (): string | null => {
  const shown = useSnackbar.getState().snack;
  return shown === null ? null : snackText(shown.message);
};

describe("useAlertsMute", () => {
  it("mutes a show with an Undo, and lifts the mute without one", async () => {
    const prefs = createPrefsStore(fakeStorage());
    let mute: AlertsMute | null = null;
    function Probe(): null {
      mute = useAlertsMute(8801, "Harbor Lights");
      return null;
    }
    await mountAsync(
      <PrefsProvider value={prefs}>
        <Probe />
      </PrefsProvider>,
    );
    const current = (): AlertsMute | null => mute;
    expect(current()?.label).toBe("Mute episode alerts");

    act(() => current()?.toggle());
    expect(prefs.getState().mutedShowIds).toEqual([8801]);
    expect(current()?.label).toBe("Unmute episode alerts");
    expect(snack()).toBe("Episode alerts muted for Harbor Lights.");

    act(() => useSnackbar.getState().snack?.actions?.[0]?.onPress());
    expect(prefs.getState().mutedShowIds).toEqual([]);
    expect(snack()).toBeNull();

    act(() => current()?.toggle());
    act(dismissSnack);
    act(() => current()?.toggle());
    expect(prefs.getState().mutedShowIds).toEqual([]);
    expect(snack()).toBeNull();
  });
});
