const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
  withDangerousMod,
} = require("expo/config-plugins");

const DIALOG_THEME = {
  name: "Theme.Cue.AlertDialog",
  parent: "Theme.Material3.DayNight.Dialog.Alert",
};
const DIALOG_TITLE = { name: "Cue.AlertDialog.Title", parent: "" };

// accentInk, overlay and fg from src/ui/tokens.ts.
const DIALOG_COLORS = {
  cue_dialog_primary: { light: "#935800", dark: "#f5b841" },
  cue_dialog_surface: { light: "#ffffff", dark: "#2b241b" },
  cue_dialog_on_surface: { light: "#1a1712", dark: "#f4efe7" },
};

const DIALOG_ITEMS = {
  colorPrimary: "@color/cue_dialog_primary",
  colorSurface: "@color/cue_dialog_surface",
  colorOnSurface: "@color/cue_dialog_on_surface",
  "android:textColorPrimary": "@color/cue_dialog_on_surface",
  "android:windowBackground": "@drawable/cue_dialog_background",
};

// React Native inflates the alert title from the activity's windowTitleStyle, and AppTheme is a light theme.
const TITLE_ITEMS = {
  "android:textAppearance": "@android:style/TextAppearance.Material.Title",
  "android:textColor": "@color/cue_dialog_on_surface",
};

// Material 3 dialogs use extra-large (28dp) corners and a 24dp side inset, as MaterialAlertDialogBuilder draws them.
const BACKGROUND = `<inset xmlns:android="http://schemas.android.com/apk/res/android" android:insetLeft="24dp" android:insetTop="24dp" android:insetRight="24dp" android:insetBottom="24dp"><shape android:shape="rectangle"><corners android:radius="28dp" /><solid android:color="?attr/colorSurface" /></shape></inset>\n`;

const assignItems = (styles, parent, items) =>
  Object.entries(items).reduce(
    (xml, [name, value]) =>
      AndroidConfig.Styles.assignStylesValue(xml, { add: true, parent, name, value }),
    styles,
  );

function applyDialogTheme(styles) {
  return assignItems(
    assignItems(assignItems(styles, DIALOG_THEME, DIALOG_ITEMS), DIALOG_TITLE, TITLE_ITEMS),
    AndroidConfig.Styles.getAppThemeGroup(),
    {
      alertDialogTheme: `@style/${DIALOG_THEME.name}`,
      "android:windowTitleStyle": `@style/${DIALOG_TITLE.name}`,
    },
  );
}

function applyDialogColors(colors, scheme) {
  return Object.entries(DIALOG_COLORS).reduce(
    (xml, [name, value]) =>
      AndroidConfig.Colors.assignColorValue(xml, { name, value: value[scheme] }),
    colors,
  );
}

function withAndroidDialogTheme(config) {
  const themed = withAndroidStyles(config, (mod) => {
    mod.modResults = applyDialogTheme(mod.modResults);
    return mod;
  });
  const light = withAndroidColors(themed, (mod) => {
    mod.modResults = applyDialogColors(mod.modResults, "light");
    return mod;
  });
  const dark = withAndroidColorsNight(light, (mod) => {
    mod.modResults = applyDialogColors(mod.modResults, "dark");
    return mod;
  });
  return withDangerousMod(dark, [
    "android",
    (mod) => {
      const directory = join(mod.modRequest.platformProjectRoot, "app/src/main/res/drawable");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "cue_dialog_background.xml"), BACKGROUND);
      return mod;
    },
  ]);
}

module.exports = withAndroidDialogTheme;
module.exports.DIALOG_COLORS = DIALOG_COLORS;
module.exports.applyDialogTheme = applyDialogTheme;
