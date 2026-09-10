import { describe, expect, it, vi } from "vitest";
import { mountAsync } from "../../../core/test/ui/_mount";
import { version as packageVersion } from "../../package.json";
import { mockCompositionRoot } from "../support/composition-root-mocks";

vi.doMock("@capacitor/app", () => ({ App: { getInfo: vi.fn() } }));
mockCompositionRoot({ native: false, clientId: "web-version-test" });

describe("Settings web app version", () => {
  it("renders the package version", async () => {
    const { AppProviders } = await import("@app/providers");
    await mountAsync(<AppProviders />);
    const rendered = document.querySelector<HTMLElement>('[data-testid="settings-version"]');
    expect(rendered?.textContent).toBe(packageVersion);
  });
});
