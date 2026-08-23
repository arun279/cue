/**
 * The SyncStrip's pending signal reads the DURABLE queue depth, not only the
 * in-flight flush counter: a mark deferred offline sits in the op-log with
 * nothing in flight, and the strip must still say so (at least 3 pending
 * for >5s → "N marks pending · will sync").
 */

import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { SyncStrip } from "@ui/app-shell/SyncStrip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let queueDepth = 0;

const runtime = { pendingWrites: () => queueDepth } as unknown as CueRuntime;

function mountStrip(): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <RuntimeProvider value={runtime}>
        <SyncStrip isError={false} />
      </RuntimeProvider>,
    ),
  );
}

const strip = (): HTMLElement | null => document.querySelector("[data-testid='sync-strip']");

beforeEach(() => {
  vi.useFakeTimers();
  queueDepth = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

describe("SyncStrip durable pending", () => {
  it("surfaces ≥3 durable ops after the 5s grace, with the will-sync copy", () => {
    queueDepth = 3;
    mountStrip();
    // Inside the grace window a burst stays silent.
    expect(strip()).toBeNull();
    act(() => vi.advanceTimersByTime(5100));
    expect(strip()?.getAttribute("data-state")).toBe("pending");
    expect(strip()?.textContent).toContain("3 marks pending · will sync");
  });

  it("stays silent below the threshold", () => {
    queueDepth = 2;
    mountStrip();
    act(() => vi.advanceTimersByTime(6000));
    expect(strip()).toBeNull();
  });

  it("clears once a background flush drains the queue, with no in-flight signal", () => {
    queueDepth = 4;
    mountStrip();
    act(() => vi.advanceTimersByTime(5100));
    expect(strip()).not.toBeNull();
    // A poll/reconnect flush drains the log without any submit bracketing;
    // the strip's own coarse re-sample must notice.
    queueDepth = 0;
    act(() => vi.advanceTimersByTime(1100));
    expect(strip()).toBeNull();
  });
});
