import { statSync } from "node:fs";

const [file, limitArgument, label = "artifact"] = process.argv.slice(2);
if (file === undefined || limitArgument === undefined) {
  throw new Error("usage: assert-file-size.mjs <file> <limit-bytes> [label]");
}

const size = statSync(file).size;
const limit = Number(limitArgument);
if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be positive bytes");
if (size > limit) throw new Error(`${label} is ${size} bytes, exceeding ${limit} bytes`);
process.stdout.write(`${label}: ${size} bytes, limit ${limit} bytes\n`);
