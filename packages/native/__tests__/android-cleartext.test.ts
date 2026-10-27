import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { nativeAppConfig } from "../app.config";

const withAndroidPrivacy = require("../plugins/with-android-privacy");

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

async function generate(apiBase: string | undefined) {
  const platformProjectRoot = mkdtempSync(path.join(tmpdir(), "android-cleartext-"));
  directories.push(platformProjectRoot);
  const config = nativeAppConfig({ EXPO_PUBLIC_TRAKT_API_BASE: apiBase });
  const entry = config.plugins?.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "./plugins/with-android-privacy",
  );
  const generated = withAndroidPrivacy(config, entry?.[1]);
  const modRequest = { platformProjectRoot };
  await generated.mods.android.dangerous({ ...generated, modRequest });
  const result = await generated.mods.android.manifest({
    ...generated,
    modRequest,
    modResults: { manifest: { application: [{ $: {} }] } },
  });
  return {
    manifest: result.modResults.manifest.application[0].$,
    resource: path.join(platformProjectRoot, "app/src/main/res/xml/cue_network_security.xml"),
  };
}

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
])("generates a scoped cleartext exception only for loopback HTTP: %s", async (apiBase, host) => {
  const { manifest, resource } = await generate(apiBase);

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
