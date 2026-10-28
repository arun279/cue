const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

// The navigation icon draws its drawable without a tint, so the drawable takes the header's
// ink from a color resource with a night variant, which follows the app's theme.
const INK = { light: "#1a1712", dark: "#f4efe7" };
const icons = {
  cue_header_close:
    "M19,6.41L17.59,5 12,10.59 6.41,5 5,6.41 10.59,12 5,17.59 6.41,19 12,13.41 17.59,19 19,17.59 13.41,12z",
};

const drawable = (pathData) =>
  `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="@color/cue_header_ink" android:pathData="${pathData}" /></vector>\n`;
const colors = (ink) => `<resources><color name="cue_header_ink">${ink}</color></resources>\n`;

function write(directory, name, content) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), content);
}

function writeHeaderIcons(res) {
  for (const [name, pathData] of Object.entries(icons))
    write(join(res, "drawable"), `${name}.xml`, drawable(pathData));
  write(join(res, "values"), "cue_header_ink.xml", colors(INK.light));
  write(join(res, "values-night"), "cue_header_ink.xml", colors(INK.dark));
  write(
    join(res, "raw"),
    "cue_header_icons_keep.xml",
    `<resources xmlns:tools="http://schemas.android.com/tools" tools:keep="${Object.keys(icons)
      .map((name) => `@drawable/${name}`)
      .join(",")}" />\n`,
  );
}

module.exports = function withAndroidHeaderIcons(config) {
  return withDangerousMod(config, [
    "android",
    (mod) => {
      writeHeaderIcons(join(mod.modRequest.platformProjectRoot, "app/src/main/res"));
      return mod;
    },
  ]);
};

module.exports.INK = INK;
module.exports.icons = icons;
module.exports.writeHeaderIcons = writeHeaderIcons;
