import { AndroidConfig } from "expo/config-plugins";
import { PALETTE } from "../src/ui/tokens";

const { applyDialogTheme, DIALOG_COLORS } = require("../plugins/with-android-dialog-theme");

it("paints Android's alert dialogs in Cue's ink, overlay and text colors", () => {
  expect(DIALOG_COLORS).toEqual({
    cue_dialog_primary: PALETTE.accentInk,
    cue_dialog_surface: PALETTE.overlay,
    cue_dialog_on_surface: PALETTE.fg,
  });
});

it("gives AppTheme a Material 3 alert dialog theme and a title in Cue's text color, leaving its other items alone", () => {
  const styles = applyDialogTheme({
    resources: {
      style: [
        {
          $: { name: "AppTheme", parent: "Theme.EdgeToEdge" },
          item: [{ $: { name: "android:statusBarColor" }, _: "#0e0c0a" }],
        },
      ],
    },
  });
  const group = (name: string) =>
    styles.resources.style.find((style: { $: { name: string } }) => style.$.name === name);

  expect(group("AppTheme").$.parent).toBe("Theme.EdgeToEdge");
  expect(AndroidConfig.Styles.getStylesGroupAsObject(styles, { name: "AppTheme" })).toEqual({
    "android:statusBarColor": "#0e0c0a",
    alertDialogTheme: "@style/Theme.Cue.AlertDialog",
    "android:windowTitleStyle": "@style/Cue.AlertDialog.Title",
  });
  expect(group("Theme.Cue.AlertDialog").$.parent).toBe("Theme.Material3.DayNight.Dialog.Alert");
  expect(
    AndroidConfig.Styles.getStylesGroupAsObject(styles, { name: "Theme.Cue.AlertDialog" }),
  ).toMatchObject({
    colorPrimary: "@color/cue_dialog_primary",
    "android:windowBackground": "@drawable/cue_dialog_background",
  });
  expect(
    AndroidConfig.Styles.getStylesGroupAsObject(styles, { name: "Cue.AlertDialog.Title" }),
  ).toMatchObject({ "android:textColor": "@color/cue_dialog_on_surface" });
});
