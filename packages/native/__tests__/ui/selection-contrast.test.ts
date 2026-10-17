import { readFileSync } from "node:fs";
import { type Appearance, PALETTE, SELECTABLE, type Selectable } from "../../src/ui/tokens";
import { nativeSourceFiles } from "../support/native-sources";

/**
 * WCAG 2.2 thresholds: 1.4.11 asks 3:1 of the visual information that marks a
 * component's state and of non-text glyphs; 1.4.3 asks 4.5:1 of text.
 */
const STATE_MIN = 3;
const GLYPH_MIN = 3;
const TEXT_MIN = 4.5;
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
type Token = keyof typeof PALETTE;

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`${hex} is not an opaque sRGB color`);
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel = Number.parseInt(hex.slice(1 + 2 * index, 3 + 2 * index), 16) / 255;
    return (
      sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function paint(selectable: Selectable, state: Appearance, theme: Theme) {
  const hex = (token: Token) => PALETTE[token][theme];
  const backdrop = hex(selectable.backdrop);
  const fill = state.fill === undefined ? backdrop : hex(state.fill);
  const stroke =
    state.stroke === undefined || hex(state.stroke) === "transparent" ? fill : hex(state.stroke);
  const ground = selectable.labelOnBackdrop === true ? backdrop : fill;
  return {
    fill,
    stroke,
    text: (["label", "detail"] as const).flatMap((channel) => {
      const token = state[channel];
      return token === undefined
        ? []
        : [{ token: `${channel} ${token}`, ratio: contrast(hex(token), ground) }];
    }),
    glyph:
      state.glyph === undefined
        ? []
        : [{ token: state.glyph, ratio: contrast(hex(state.glyph), fill) }],
  };
}

function measure(): { check: string; ratio: number; min: number }[] {
  return Object.entries(SELECTABLE).flatMap(([name, selectable]) =>
    THEMES.flatMap((theme) => {
      const on = paint(selectable, selectable.selected, theme);
      const off = paint(selectable, selectable.unselected, theme);
      const states = [
        ["selected", on],
        ["unselected", off],
      ] as const;
      return [
        {
          check: `${name} ${theme} state`,
          ratio: Math.max(contrast(on.fill, off.fill), contrast(on.stroke, off.stroke)),
          min: STATE_MIN,
        },
        ...states.flatMap(([state, look]) => [
          ...look.text.map(({ token, ratio }) => ({
            check: `${name} ${theme} ${state} ${token} text`,
            ratio,
            min: TEXT_MIN,
          })),
          ...look.glyph.map(({ token, ratio }) => ({
            check: `${name} ${theme} ${state} ${token} glyph`,
            ratio,
            min: GLYPH_MIN,
          })),
        ]),
      ];
    }),
  );
}

const sources = nativeSourceFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }));

it("separates every selectable state and keeps its text and glyphs legible in both themes", () => {
  const checks = measure();

  expect(checks.length).toBeGreaterThan(0);
  expect(
    checks
      .filter(({ ratio, min }) => ratio < min)
      .map(({ check, ratio, min }) => `${check} ${ratio.toFixed(2)} < ${min}`),
  ).toEqual([]);
});

it("draws every selected or checked state from the gated pairs", () => {
  const bypassing = sources.flatMap(({ path, text }) =>
    [...text.matchAll(/accessibilityState=\{\{[^}]*\b(selected|checked)\b/g)]
      .filter(
        (match) => [...text.slice(0, match.index).matchAll(/<(\w+)/g)].at(-1)?.[1] !== "Switch",
      )
      .filter(() => !text.includes("SELECTABLE."))
      .map(() => path),
  );
  const inline = sources.flatMap(({ path, text }) =>
    /\bselected:\s*(\{\s*color:\s*)?colors\./.test(text) ? [path] : [],
  );
  const named = Object.keys(PALETTE).filter((token) => /selected|active|checked/i.test(token));
  const paired = new Set<string>(
    Object.values(SELECTABLE).flatMap((selectable) => [
      selectable.backdrop,
      ...Object.values(selectable.selected),
      ...Object.values(selectable.unselected),
    ]),
  );
  const consumed = sources.map(({ text }) => text).join("\n");

  expect([...new Set([...bypassing, ...inline])]).toEqual([]);
  expect(named.filter((token) => !paired.has(token))).toEqual([]);
  expect(
    Object.keys(SELECTABLE).filter((name) => !new RegExp(`SELECTABLE\\.${name}\\b`).test(consumed)),
  ).toEqual([]);
});
