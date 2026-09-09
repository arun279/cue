import { readFileSync } from "node:fs";

const [file, limitArgument] = process.argv.slice(2);
if (file === undefined || limitArgument === undefined) {
  throw new Error("usage: assert-app-thinning-size.mjs <report> <limit-bytes>");
}

const units = { B: 1, KB: 1000, MB: 1_000_000, GB: 1_000_000_000 };
const sizes = [
  ...readFileSync(file, "utf8").matchAll(/App size:\s*([\d.]+)\s*(B|KB|MB|GB) compressed/g),
].map(([, amount, unit]) => Number(amount) * units[unit]);
if (sizes.length === 0) throw new Error(`${file}: no compressed app sizes found`);

const maximum = Math.max(...sizes);
const limit = Number(limitArgument);
if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be positive bytes");
if (maximum > limit) {
  throw new Error(`App Store download: ${maximum} bytes, exceeding ${limit} bytes`);
}
process.stdout.write(`App Store download: ${maximum} bytes, limit ${limit} bytes\n`);
