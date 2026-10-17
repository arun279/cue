import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { tempDirectory } from "../support/temp-directory";

describe("Android harness cleartext isolation", () => {
  it("keeps the fake origin out of the release workflow", () => {
    expect(
      readFileSync(repositoryPath(".github/workflows/mobile-release.yml"), "utf8"),
    ).not.toContain("EXPO_PUBLIC_TRAKT_API_BASE");
  });

  it.each([
    [undefined, null],
    ["", null],
    ["https://127.0.0.1:8787", null],
    ["https://localhost:8787", null],
    ["http://example.com:8787", null],
    ["http://localhost.example.com:8787", null],
    ["http://127.0.0.1@example.com:8787", null],
    ["http://127.0.0.1:8787", "127.0.0.1"],
    ["http://localhost:8787", "localhost"],
  ])("generates a scoped exception only for loopback HTTP: %s", (apiBase, host) => {
    const directory = tempDirectory("android-cleartext-");
    const manifest = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "-e",
          `const { nativeAppConfig } = require('./packages/native/app.config.ts');
          const config = nativeAppConfig(JSON.parse(process.argv[1]));
          const entry = config.plugins.find(p => Array.isArray(p) && p[0] === './plugins/with-android-privacy');
          const plugin = require('./packages/native/plugins/with-android-privacy.js');
          const generated = plugin(config, entry?.[1]);
          const modRequest = { platformProjectRoot: process.argv[2] };
          (async () => {
            await generated.mods.android.dangerous({ ...generated, modRequest });
            const result = await generated.mods.android.manifest({ ...generated, modRequest,
              modResults: { manifest: { application: [{ $: {} }] } } });
            console.log(JSON.stringify(result.modResults.manifest.application[0].$));
          })();`,
          JSON.stringify({ EXPO_PUBLIC_TRAKT_API_BASE: apiBase }),
          directory,
        ],
        { cwd: repositoryPath(), encoding: "utf8" },
      ),
    );
    const resource = path.join(directory, "app/src/main/res/xml/cue_network_security.xml");
    expect(manifest["android:usesCleartextTraffic"]).toBeUndefined();
    if (host === null) {
      expect(manifest["android:networkSecurityConfig"]).toBeUndefined();
      expect(existsSync(resource)).toBe(false);
    } else {
      expect(manifest["android:networkSecurityConfig"]).toBe("@xml/cue_network_security");
      expect(readFileSync(resource, "utf8")).toBe(`<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">${host}</domain>
    </domain-config>
</network-security-config>
`);
    }
  });
});
