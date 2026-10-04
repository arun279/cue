/** @jest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(__dirname, "..");
const nativeDirectories = ["app", "src"].map((directory) => join(root, directory));

/**
 * A header slot handed a React element gets that element wrapped in a bar item
 * the system sizes around it, at the element's own type and padding rather than
 * the bar's. Header actions are declared with `Stack.Toolbar` so iOS draws them
 * as UIBarButtonItems.
 */
const CUSTOM_HEADER_CONTENT =
  /\b(?:headerLeft|headerRight|unstable_headerLeftItems|unstable_headerRightItems)\s*:|<Stack\.Toolbar\b[^>]*\basChild\b|<Stack\.Toolbar\.View\b/g;

const ANDROID_COMPOSE =
  "expo-router hosts Android bar items in a Compose view that the native header lays out at zero width, so Android's bar keeps icon-only React content.";

const ALLOWED: Readonly<Record<string, string>> = {
  "src/ui/BarItems.tsx <Stack.Toolbar.View":
    "The avatar is the account's photo or its monogram, a picture no bar item image can draw.",
  'src/ui/BarItems.tsx <Stack.Toolbar placement="right" asChild': ANDROID_COMPOSE,
  'app/(account)/_layout.tsx <Stack.Toolbar placement="right" asChild': ANDROID_COMPOSE,
  "src/screens/MovieDetail.tsx headerRight:":
    "An icon-only overflow menu drawn by the platform menu; it carries no text label.",
  "src/screens/ShowDetail.tsx headerRight:":
    "An icon-only overflow menu drawn by the platform menu; it carries no text label.",
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function customHeaderContent(): string[] {
  return nativeDirectories
    .flatMap(sourceFiles)
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(CUSTOM_HEADER_CONTENT)].map(
        (match) => `${relative(root, file)} ${match[0].replace(/\s+/g, " ")}`,
      ),
    );
}

it("puts no custom element in a header slot outside the reasoned exceptions", () => {
  expect(customHeaderContent().filter((site) => !(site in ALLOWED))).toEqual([]);
});

it("keeps every exception live, so a resolved one leaves the list", () => {
  const sites = new Set(customHeaderContent());
  expect(Object.keys(ALLOWED).filter((site) => !sites.has(site))).toEqual([]);
});
