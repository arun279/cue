import { readFileSync } from "node:fs";

const [file, limitArgument, label = "bundletool maximum"] = process.argv.slice(2);
if (file === undefined) {
  throw new Error("usage: bundletool-size.mjs <csv> [limit-bytes] [label]");
}

const rows = readFileSync(file, "utf8")
  .trim()
  .split(/\r?\n/)
  .map((row) => row.split(","));
const maximumColumn = rows[0]?.indexOf("MAX") ?? -1;
const maximum = Math.max(...rows.slice(1).map((row) => Number(row[maximumColumn])));
if (!Number.isSafeInteger(maximum)) throw new Error(`${file}: bundletool reported no numeric MAX`);

if (limitArgument === "--value-only") {
  process.stdout.write(`${maximum}\n`);
  process.exit(0);
}

if (limitArgument === undefined || limitArgument === "--report") {
  process.stdout.write(`${label}: ${maximum} bytes\n`);
  process.exit(0);
}

const limit = Number(limitArgument);
if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be positive bytes");
if (maximum > limit) throw new Error(`${label}: ${maximum} bytes, exceeding ${limit} bytes`);
process.stdout.write(`${label}: ${maximum} bytes, limit ${limit} bytes\n`);
