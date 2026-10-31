import { statSync } from "node:fs";
import { expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";

it("gives the install its own copy of a file Android builds rewrite in place", () => {
  const manifest = repositoryPath(
    "node_modules/@react-native-masked-view/masked-view/android/src/main/AndroidManifest.xml",
  );

  expect(statSync(manifest).nlink).toBe(1);
});
