import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook } from "@testing-library/react-native";
import { Platform, processColor, useColorScheme } from "react-native";
import { PALETTE, useColors } from "../../src/ui/tokens";

/**
 * The React Native jest preset already replaces `useColorScheme` with a mock
 * pinned to "light", which is the seam this file drives: the palette's whole
 * Android half is a function of that value, and its iOS half deliberately is
 * not. Both projects run the file, because a single-platform run would miss
 * exactly the two divergences below.
 */
const scheme = jest.mocked(useColorScheme);

async function colorsUnder(value: "light" | "dark") {
  scheme.mockReturnValue(value);
  const { result } = await renderHook(() => useColors());
  return result.current;
}

afterEach(() => scheme.mockReturnValue("light"));

it("resolves the scheme on Android and leaves it to the system on iOS", async () => {
  const dark = await colorsUnder("dark");
  const light = await colorsUnder("light");

  if (Platform.OS === "ios") {
    // One map of dynamic values, so nothing here changes when the scheme does.
    expect(light.bg).toBe(dark.bg);
  } else {
    expect(dark.bg).toBe("#0e0c0a");
    expect(light.bg).toBe("#fbfaf7");
  }
});

it("takes the separator from the platform on iOS and from --color-border on Android", async () => {
  const colors = await colorsUnder("dark");

  if (Platform.OS === "ios") {
    expect(colors.separator).not.toBe(colors.border);
  } else {
    expect(colors.separator).toBe(colors.border);
  }
});

it("carries a light-only stroke for amber fills, so a fill can draw it unconditionally", async () => {
  if (Platform.OS === "ios") {
    // A dynamic value cannot be read back, so what is checkable here is that the
    // token exists and is not the raw light hex the Android branch resolves to.
    expect((await colorsUnder("dark")).accentFillStroke).not.toBe("#935800");
    return;
  }
  expect(processColor((await colorsUnder("dark")).accentFillStroke)).toBe(
    processColor("transparent"),
  );
  expect((await colorsUnder("light")).accentFillStroke).toBe("#935800");
});

it("matches the web palette with border-strong and focus deliberately absent", () => {
  const css = readFileSync(resolve(__dirname, "../../../web/src/ui/styles.css"), "utf8");
  const declarations = (block: string) =>
    Object.fromEntries(
      Array.from(
        block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g),
        ([, name = "", value = ""]) => [
          name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()),
          value.replace(/\s/g, ""),
        ],
      ),
    );
  const defaults = declarations(css.match(/@theme static \{([^}]+)\}/)?.[1] ?? "");
  const nativeOnly = new Set(["accentFillStroke", "separator"]);
  for (const theme of ["light", "dark"] as const) {
    const block = css.match(new RegExp(`:root\\[data-theme="${theme}"\\] \\{([^}]+)\\}`));
    expect(block).not.toBeNull();
    const { borderStrong, focus, ...web } = {
      ...defaults,
      ...declarations(block?.[1] ?? ""),
    };
    expect(borderStrong).toBeDefined();
    expect(focus).toBeDefined();
    expect(
      Object.fromEntries(
        Object.entries(PALETTE)
          .filter(([name]) => !nativeOnly.has(name))
          .map(([name, pair]) => [name, pair[theme]]),
      ),
    ).toEqual(web);
  }
});
