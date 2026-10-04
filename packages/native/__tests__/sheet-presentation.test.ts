/** @jest-environment node */

import { readFileSync } from "node:fs";
import { nativeSourceFiles } from "./support/native-sources";

const SELF_DRAWN_MODAL = [
  /\baccessibilityViewIsModal\b/,
  /\baria-modal\b/,
  /import\s*{[^}]*\bModal\b[^}]*}\s*from\s*"react-native"/,
];

it("presents sheets through navigation rather than drawing a modal over the screen", () => {
  const drawn = nativeSourceFiles().filter((file) => {
    const source = readFileSync(file, "utf8");
    return SELF_DRAWN_MODAL.some((pattern) => pattern.test(source));
  });

  expect(drawn).toEqual([]);
});
