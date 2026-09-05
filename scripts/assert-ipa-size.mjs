import { readFileSync } from "node:fs";

const [reportPath, limitArgument] = process.argv.slice(2);
if (reportPath === undefined || limitArgument === undefined) {
  throw new Error("usage: assert-ipa-size.mjs <report> <limit-bytes>");
}

const sizes = [
  ...readFileSync(reportPath, "utf8").matchAll(
    /^App size:\s+(Zero|[\d][\d,\s]*(?:\.\d+)?)\s+([KMG]B)\s+compressed,/gim,
  ),
].map(([, value, unit]) => {
  if (value.toLowerCase() === "zero") return 0;
  const multiplier = { KB: 1_000, MB: 1_000_000, GB: 1_000_000_000 }[unit.toUpperCase()];
  return Number(value.replace(/[\s,]/g, "")) * multiplier;
});
if (sizes.length === 0) throw new Error("no compressed app sizes found in thinning report");

const size = Math.max(...sizes);
const limit = Number(limitArgument);
if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be positive bytes");
if (size > limit) {
  throw new Error(`largest compressed IPA variant is ${size} bytes, exceeding ${limit} bytes`);
}
process.stdout.write(`largest compressed IPA variant: ${size} bytes, limit ${limit} bytes\n`);
