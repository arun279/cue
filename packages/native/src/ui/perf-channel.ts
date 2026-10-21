import { type Href, router } from "expo-router";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useWindowDimensions } from "react-native";
import { appReady } from "./AppIdle";

// Served by scripts/perf-probe.mjs on the host; adb reverse carries the port to the emulator.
const CHANNEL = "http://127.0.0.1:8790/next";
const SCROLL_STEPS = 3;
const SCROLL_STEP_MS = 700;

type Command = (...words: string[]) => void;

const TABS = new Map<string, Href>([
  ["up-next", "/"],
  ["library", "/library"],
  ["calendar", "/calendar"],
]);

const commands = new Map<string, Command>([
  [
    "tab",
    (name = "") => {
      const href = TABS.get(name);
      if (href === undefined) throw new Error(`no tab ${name}`);
      router.navigate(href);
    },
  ],
  ["show", (showId) => router.push(`/show/${showId}`)],
  [
    "episode",
    (showId, season, episode) => router.push(`/show/${showId}/episode/${season}/${episode}`),
  ],
  ["history", () => router.push("/history")],
  ["back", () => router.back()],
]);

/** Runs one command from the host and describes the outcome for its reply. */
export function perform(command: string): string {
  const [name = "", ...words] = command.split(" ");
  const run = commands.get(name);
  if (run === undefined) return `unknown ${name}`;
  try {
    run(...words);
    return `ran ${name}`;
  } catch (error) {
    return `failed ${name}: ${String(error)}`;
  }
}

/**
 * Lets the host run a screen's own action, so a measured interaction starts without a test
 * driver reading the app's view hierarchy, which blocks its main thread while it runs.
 */
export function usePerfCommand(name: string, run: Command): void {
  const latest = useRef(run);
  useLayoutEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    commands.set(name, (...words) => latest.current(...words));
    return () => {
      commands.delete(name);
    };
  }, [name]);
}

/** `scroll:<name>` moves a list down a screen at a time, three times, the way three flings would. */
export function usePerfScroll(name: string, scrollTo: (offset: number) => void): void {
  const { height } = useWindowDimensions();
  usePerfCommand(`scroll:${name}`, () => {
    for (let step = 1; step <= SCROLL_STEPS; step += 1) {
      setTimeout(() => scrollTo(step * height), (step - 1) * SCROLL_STEP_MS);
    }
  });
}

/** Once the app is idle, waits on the host for commands and replies with each outcome. */
export function PerfChannel(): null {
  useEffect(() => {
    let open = true;
    void (async () => {
      await appReady;
      let reply = "ready";
      while (open) {
        const response = await fetch(`${CHANNEL}?reply=${encodeURIComponent(reply)}`);
        reply = perform(await response.text());
      }
    })().catch(() => undefined);
    return () => {
      open = false;
    };
  }, []);
  return null;
}
