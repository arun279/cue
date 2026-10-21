import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { changedPixels } from "./changed-pixels.mjs";

const [work, out, baseSha, headSha] = process.argv.slice(2);
if (headSha === undefined) {
  throw new Error("usage: compare-screenshots.mjs <work-dir> <out-dir> <base-sha> <head-sha>");
}

const PANEL_WIDTH = 800;
const GAP = 24;
const TINT = [255, 0, 255];
const TEXT_SIZES = { xxxl: "XXXL text", ax5: "AX5 text" };
const PLATFORMS = { ios: "iOS", android: "Android" };
const PENDING = "Verdict: VERDICT_PENDING";

const files = (entry) =>
  statSync(entry).isDirectory()
    ? readdirSync(entry).flatMap((child) => files(path.join(entry, child)))
    : [entry];

const captures = (side, artifact) => {
  const root = path.join(work, side, artifact);
  const found = statSync(root, { throwIfNoEntry: false }) ? files(root) : [];
  return new Map(
    found
      .filter((file) => path.basename(path.dirname(file)) === "takeScreenshot")
      .map((file) => [path.basename(file, ".png"), file]),
  );
};

const lanes = readFileSync(path.join(work, "lanes.tsv"), "utf8")
  .replace(/\n$/, "")
  .split("\n")
  .map((row) => {
    const [side, artifact, note] = row.split("\t");
    const [, platform, appearance, suite] =
      /^ui-screenshots-(ios|android)-(light|dark)(?:-(.+))?$/.exec(artifact) ?? [];
    return {
      side,
      artifact,
      note,
      platform: PLATFORMS[platform],
      appearance,
      suite,
      captures: captures(side, artifact),
    };
  });
const lane = (side, artifact) =>
  lanes.find((entry) => entry.side === side && entry.artifact === artifact);
const peers = (side, lane) =>
  lanes.filter(
    (entry) =>
      entry.side === side &&
      entry.platform === lane.platform &&
      entry.appearance === lane.appearance,
  );

const unreadable = [];
const read = (file, entry, name) => {
  try {
    return PNG.sync.read(readFileSync(file));
  } catch {
    unreadable.push(
      `- The ${entry.side} capture of ${caption(entry, name)} could not be read as a PNG.`,
    );
    return undefined;
  }
};

const tint = (image, diff) => {
  const data = Buffer.from(image.data);
  for (let i = 3; i < diff.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i - 3 + c] = diff[i] === 0 ? data[i - 3 + c] >> 1 : TINT[c];
    }
  }
  return { width: image.width, height: image.height, data };
};

const average = (image, [x0, x1], [y0, y1]) => {
  const sum = [0, 0, 0, 0];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      for (let c = 0; c < 4; c++) sum[c] += image.data[(y * image.width + x) * 4 + c];
    }
  }
  return sum.map((total) => total / ((y1 - y0) * (x1 - x0)));
};

const scale = (image) => {
  const ratio = image.width / PANEL_WIDTH;
  const height = Math.round(image.height / ratio);
  const data = new Uint8Array(PANEL_WIDTH * height * 4);
  const span = (index, limit) => {
    const start = Math.min(Math.floor(index * ratio), limit - 1);
    return [start, Math.max(start + 1, Math.min(Math.floor((index + 1) * ratio), limit))];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < PANEL_WIDTH; x++) {
      data.set(
        average(image, span(x, image.width), span(y, image.height)),
        (y * PANEL_WIDTH + x) * 4,
      );
    }
  }
  return { width: PANEL_WIDTH, height, data };
};

const compose = (images, file) => {
  const panels = images.map(scale);
  const sheet = new PNG({
    width: panels.length * PANEL_WIDTH + (panels.length - 1) * GAP,
    height: Math.max(...panels.map(({ height }) => height)),
  });
  panels.forEach((panel, index) => {
    for (let y = 0; y < panel.height; y++) {
      sheet.data.set(
        panel.data.subarray(y * PANEL_WIDTH * 4, (y + 1) * PANEL_WIDTH * 4),
        (y * sheet.width + index * (PANEL_WIDTH + GAP)) * 4,
      );
    }
  });
  writeFileSync(path.join(out, file), PNG.sync.write(sheet));
};

const describe = (name) => {
  const [, screen, size] = /^(.+?)(?:-(xxxl|ax5))?$/.exec(name);
  const words = screen.replaceAll("-", " ");
  return { screen, size, words: words[0].toUpperCase() + words.slice(1) };
};

const caption = (entry, name) => {
  const { words, size } = describe(name);
  return `${words}, ${entry.platform}, ${entry.appearance}, ${TEXT_SIZES[size] ?? "default text"}`;
};

mkdirSync(out, { recursive: true });
const changes = [];
const removed = [];
let compared = 0;
for (const after of lanes.filter(({ side }) => side === "after")) {
  for (const [name, file] of [...after.captures].sort(([a], [b]) => a.localeCompare(b))) {
    const before =
      peers("before", after).find((entry) => entry.captures.has(name)) ??
      lane("before", after.artifact);
    const baseFile = before.captures.get(name);
    if (baseFile === undefined && peers("before", after).some((entry) => entry.note !== ""))
      continue;
    const head = read(file, after, name);
    const base = baseFile === undefined ? undefined : read(baseFile, before, name);
    if (head === undefined || (baseFile !== undefined && base === undefined)) continue;
    const diff = base === undefined ? undefined : changedPixels(base, head, after.platform);
    if (base !== undefined) compared++;
    if (base !== undefined && diff === undefined) continue;
    const { screen, size } = describe(name);
    const pairFile = size === undefined ? undefined : after.captures.get(screen);
    const pair = pairFile === undefined ? undefined : read(pairFile, after, screen);
    const panels = [
      ...(base === undefined ? [] : [base]),
      head,
      ...(diff === undefined ? [] : [tint(head, diff)]),
    ];
    const labels = base === undefined ? ["after"] : ["before", "after", "changes"];
    if (size !== undefined) {
      panels.unshift(...(pair === undefined ? [] : [pair]));
      labels.unshift(...(pair === undefined ? [] : ["default text after"]));
    }
    const image = `${after.platform}-${after.appearance}-${name}.png`.toLowerCase();
    compose(panels, image);
    changes.push({
      title: `${base === undefined ? "New" : "Changed"}: ${caption(after, name)}`,
      order: labels.join(", "),
      image,
      alt: caption(after, name),
      unpaired: size !== undefined && pair === undefined,
    });
  }
  if (peers("after", after).some((entry) => entry.note !== "")) continue;
  for (const name of lane("before", after.artifact).captures.keys()) {
    if (!peers("after", after).some((entry) => entry.captures.has(name))) {
      removed.push(caption(after, name));
    }
  }
}

const screens = (count) => `${count} screen${count === 1 ? "" : "s"}`;
const range = `base \`${baseSha.slice(0, 7)}\` and head \`${headSha.slice(0, 7)}\``;
const missing = [
  ...lanes
    .filter(({ note }) => note !== "")
    .map(
      (entry) =>
        `- ${entry.side === "before" ? "Before" : "After"} captures for ${entry.platform} ${entry.appearance}${entry.suite ? ` (${entry.suite} flows)` : ""} ${entry.note}.`,
    ),
  ...unreadable,
];
const sections = ["<!-- media-review -->"];
if (changes.length === 0 && removed.length === 0) {
  sections.push(
    missing.length === 0
      ? `No screen changed between ${range}; ${screens(compared)} compared.`
      : `No compared screen changed between ${range}; ${screens(compared)} compared.`,
  );
} else {
  sections.push(
    `Before is base \`${baseSha.slice(0, 7)}\`, after is head \`${headSha.slice(0, 7)}\`; ${screens(compared)} compared. The changes panel dims the after screen and marks changed pixels in magenta; the status bar, the scroll indicators and the top edge of the iOS tab bar's glass are not compared.`,
  );
  for (const change of changes) {
    sections.push(
      `**${change.title}.** Left to right: ${change.order}.${change.unpaired ? " No default-size capture of this screen exists to pair it with." : ""}`,
      `![${change.alt}](${change.image})`,
      PENDING,
    );
  }
  if (removed.length > 0) {
    sections.push(`Removed screens:\n\n${removed.map((name) => `- ${name}`).join("\n")}`);
  }
}
if (missing.length > 0) sections.push(`Not compared:\n\n${missing.join("\n")}`);
writeFileSync(path.join(out, "review.md"), `${sections.join("\n\n")}\n`);
