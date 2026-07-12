import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

/**
 * Shared act-mount scaffolding for suites that render a real React tree: flag
 * the act environment once and own the root/host lifecycle, so each suite only
 * describes what it mounts. The host is body-attached (portals land in
 * `document.body`) and everything is torn down after every test.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = "";
});

function createHost(): Root {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  return root;
}

/** Mount under a sync `act`: effects run, but async work is left to the test. */
export function mount(node: ReactNode): void {
  const r = createHost();
  act(() => r.render(node));
}

/** Mount under async `act`, then flush once more so mount-time effects and
 * their microtasks settle before the first assertion. */
export async function mountAsync(node: ReactNode): Promise<void> {
  const r = createHost();
  await act(async () => r.render(node));
  await act(async () => {});
}
