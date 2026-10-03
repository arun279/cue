import { readFileSync } from "node:fs";

const ENTRY = /^\s*- (GHSA-[\w-]+)(?: # ([^:\s]+):)?/gm;

export const readAuditIgnores = (workspaceFile) =>
  [...readFileSync(workspaceFile, "utf8").matchAll(ENTRY)].map(([, ghsa, packageName]) => {
    if (packageName === undefined) throw new Error(`${ghsa} names no package`);
    return { ghsa, packageName };
  });
