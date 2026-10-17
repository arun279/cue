// Plain requires keep this order and let Metro drop the test clock from store builds, where the variable is unset.
if (process.env["EXPO_PUBLIC_CLOCK_START"]) {
  const { shiftedDate }: typeof import("./src/shifted-date") = require("./src/shifted-date");
  globalThis.Date = shiftedDate(Date.parse(process.env["EXPO_PUBLIC_CLOCK_START"]));
}
require("expo-router/entry");
