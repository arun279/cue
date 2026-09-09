import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [exportArgument = "packages/native/dist", manifestArgument = ".native-assets.json"] =
  process.argv.slice(2);
const exportDirectory = path.resolve(root, exportArgument);
const manifest = JSON.parse(readFileSync(path.resolve(root, manifestArgument), "utf8"));
const metadata = JSON.parse(readFileSync(path.join(exportDirectory, "metadata.json"), "utf8"));
const actualByPath = new Map();
for (const [platform, { assets }] of Object.entries(metadata.fileMetadata)) {
  for (const { path: assetPath, ext } of assets) {
    const asset = actualByPath.get(assetPath) ?? {
      path: assetPath,
      type: ext,
      bytes: statSync(path.join(exportDirectory, assetPath)).size,
      platforms: [],
    };
    asset.platforms.push(platform);
    actualByPath.set(assetPath, asset);
  }
}

const expectedByPath = new Map(manifest.assets.map((asset) => [asset.path, asset]));
for (const asset of actualByPath.values()) {
  const expected = expectedByPath.get(asset.path);
  if (expected === undefined) {
    throw new Error(`unlisted native asset: ${asset.path} (${asset.bytes} bytes)`);
  }
  if (JSON.stringify(asset) !== JSON.stringify(expected)) {
    throw new Error(`native asset changed: ${asset.path}`);
  }
}
for (const asset of manifest.assets) {
  if (!actualByPath.has(asset.path)) throw new Error(`listed native asset is gone: ${asset.path}`);
}

const total = [...actualByPath.values()].reduce((sum, asset) => sum + asset.bytes, 0);
process.stdout.write(`native assets: ${actualByPath.size} files, ${total} bytes\n`);
