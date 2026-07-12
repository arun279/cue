/**
 * Mount-level smoke for the shared overlay/control primitives: until the
 * screens adopt them (and the Playwright suite takes over), this is the only
 * gate proving the Radix wiring holds — the portal mounts, the dialog is
 * labeled by its first heading, and rows/buttons run-then-close.
 */
import { ActionSheet } from "@ui/components/ActionSheet";
import { Chip } from "@ui/components/Chip";
import { ConfirmSheet } from "@ui/components/ConfirmSheet";
import { ContextMenu } from "@ui/components/ContextMenu";
import { CountdownPanel } from "@ui/components/CountdownPanel";
import { SegmentedControl } from "@ui/components/SegmentedControl";
import { Sheet } from "@ui/components/Sheet";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(node: ReactNode): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(node));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
});

const dialog = (): HTMLElement | null => document.querySelector("[role='dialog']");
const click = (el: Element | null): void => {
  act(() => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("overlay primitive smoke", () => {
  it("mounts a Sheet labeled by its first heading, grabber hidden", () => {
    mount(
      <Sheet open onOpenChange={() => {}}>
        <h2>Season 2</h2>
      </Sheet>,
    );
    const panel = dialog();
    expect(panel).not.toBeNull();
    expect(panel?.className).toBe("sheet");
    const labelledBy = panel?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? "")?.textContent).toBe("Season 2");
    expect(panel?.querySelector(".sheet__handle")?.getAttribute("aria-hidden")).toBe("true");
    expect(panel?.querySelector(".sheet__grabber")).not.toBeNull();
    expect(document.querySelector(".sheet-scrim")).not.toBeNull();
  });

  it("opens a tall Sheet at the 65% detent", () => {
    mount(
      <Sheet open onOpenChange={() => {}} detents="tall">
        <h2>Episode</h2>
      </Sheet>,
    );
    expect(dialog()?.getAttribute("data-detent")).toBe("open");
    expect(dialog()?.getAttribute("data-detents")).toBe("tall");
  });

  it("runs an ActionSheet row then closes", () => {
    const onPress = vi.fn();
    const onOpenChange = vi.fn();
    mount(
      <ActionSheet
        open
        onOpenChange={onOpenChange}
        title="The Wire"
        rows={[{ label: "Stop show", danger: true, testId: "row-stop", onPress }]}
      />,
    );
    const row = document.querySelector("[data-testid='row-stop']");
    expect(row?.getAttribute("data-danger")).toBe("true");
    click(row);
    expect(onPress).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("wires ConfirmSheet primary + cancel", () => {
    const primary = vi.fn();
    const onOpenChange = vi.fn();
    mount(
      <ConfirmSheet
        open
        onOpenChange={onOpenChange}
        title="Mark Season 2 watched?"
        body="5 of 13 episodes are unwatched."
        primary={{ label: "Mark 5 remaining", testId: "confirm-sheet-primary", onPress: primary }}
        secondary={{ label: "Mark all 13 again (rewatch)", onPress: () => {} }}
      />,
    );
    const labelledBy = dialog()?.getAttribute("aria-labelledby");
    expect(document.getElementById(labelledBy ?? "")?.textContent).toBe("Mark Season 2 watched?");
    click(document.querySelector("[data-testid='confirm-sheet-primary']"));
    expect(primary).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const buttons = [...document.querySelectorAll(".sheet-btn")].map((b) => b.textContent);
    expect(buttons).toEqual(["Mark 5 remaining", "Mark all 13 again (rewatch)", "Cancel"]);
  });

  it("opens a ContextMenu sheet from a right-click", () => {
    mount(
      <ContextMenu title="S1 E5" rows={[{ label: "Add another play", onPress: () => {} }]}>
        <span data-testid="target">row</span>
      </ContextMenu>,
    );
    expect(dialog()).toBeNull();
    act(() => {
      document
        .querySelector("[data-testid='target']")
        ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(dialog()).not.toBeNull();
    expect(document.querySelector(".sheet-menu__row")?.textContent).toBe("Add another play");
  });

  it("renders Chip selection and SegmentedControl changes", () => {
    const onChange = vi.fn();
    mount(
      <>
        <Chip label="Watching" count={9} selected testId="chip-watching" onPress={() => {}} />
        <Chip variant="month-jump" label="Jul 2026" onPress={() => {}} />
        <SegmentedControl
          options={[
            { value: "shows", label: "Shows" },
            { value: "movies", label: "Movies", testId: "seg-movies" },
          ]}
          value="shows"
          onChange={onChange}
          ariaLabel="Library type"
        />
      </>,
    );
    const chip = document.querySelector("[data-testid='chip-watching']");
    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    expect(chip?.getAttribute("data-selected")).toBe("true");
    expect(chip?.querySelector(".chip__count")?.textContent).toBe("9");
    expect(document.querySelector("[data-variant='month-jump'] svg")).not.toBeNull();
    click(document.querySelector("[data-testid='seg-movies']"));
    expect(onChange).toHaveBeenCalledWith("movies");
  });

  it("renders both CountdownPanel modes", () => {
    const now = Date.UTC(2026, 6, 12);
    mount(
      <>
        <CountdownPanel mode="unaired-episode" date="2026-07-16T20:00:00.000Z" />
        <CountdownPanel
          mode="returning-season"
          date={new Date(now + 26 * 86400000).toISOString()}
          title="S3"
          now={now}
        />
      </>,
    );
    expect(document.querySelector(".countdown-panel__when")?.textContent).toMatch(/^Airs /);
    expect(document.querySelector(".countdown-text")?.textContent).toBe("S3 in 26 days");
  });
});
