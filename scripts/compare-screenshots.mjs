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
const OUTLINE = [255, 0, 0, 255];
const OUTLINE_WIDTH = 3;
const OUTLINE_PADDING = 4;
// Capture pixels: wider than the space between words, narrower than the space
// between separate controls, so one changed label gets one box.
const REGION_GAP = 16;
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

const dilateLine = (source, target, { base, length, step, radius }) => {
  let inside = 0;
  for (let i = 0; i < Math.min(radius, length); i++) inside += source[base + i * step];
  for (let i = 0; i < length; i++) {
    if (i + radius < length) inside += source[base + (i + radius) * step];
    if (i > radius) inside -= source[base + (i - radius - 1) * step];
    target[base + i * step] = inside > 0 ? 1 : 0;
  }
};

const dilate = (mask, width, height, radius) => {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    dilateLine(mask, rows, { base: y * width, length: width, step: 1, radius });
  }
  const square = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    dilateLine(rows, square, { base: x, length: height, step: width, radius });
  }
  return square;
};

const neighbours = (at, width, size) =>
  [
    at - width,
    at + width,
    at % width > 0 ? at - 1 : -1,
    at % width < width - 1 ? at + 1 : -1,
  ].filter((next) => next >= 0 && next < size);

const label = (area, width) => {
  const labels = new Int32Array(area.length).fill(-1);
  const queue = new Int32Array(area.length);
  let count = 0;
  for (let start = 0; start < area.length; start++) {
    if (area[start] === 0 || labels[start] !== -1) continue;
    labels[start] = count;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    while (head < tail) {
      for (const next of neighbours(queue[head++], width, area.length)) {
        if (area[next] === 0 || labels[next] !== -1) continue;
        labels[next] = count;
        queue[tail++] = next;
      }
    }
    count++;
  }
  return { labels, count };
};

const regions = (diff, width, height) => {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = diff[i * 4 + 3] === 0 ? 0 : 1;
  const { labels, count } = label(dilate(mask, width, height, REGION_GAP / 2), width);
  const boxes = Array.from({ length: count }, () => [width, height, -1, -1]);
  for (let at = 0; at < mask.length; at++) {
    if (mask[at] === 0) continue;
    const box = boxes[labels[at]];
    const [x, y] = [at % width, Math.floor(at / width)];
    box.splice(
      0,
      4,
      Math.min(box[0], x),
      Math.min(box[1], y),
      Math.max(box[2], x),
      Math.max(box[3], y),
    );
  }
  return boxes;
};

const outline = (panel, boxes, ratio) => {
  const data = Uint8Array.from(panel.data);
  const paint = (x, y) => data.set(OUTLINE, (y * panel.width + x) * 4);
  for (const [x0, y0, x1, y1] of boxes) {
    const left = Math.max(0, Math.floor(x0 / ratio) - OUTLINE_PADDING);
    const top = Math.max(0, Math.floor(y0 / ratio) - OUTLINE_PADDING);
    const right = Math.min(panel.width - 1, Math.ceil((x1 + 1) / ratio) + OUTLINE_PADDING);
    const bottom = Math.min(panel.height - 1, Math.ceil((y1 + 1) / ratio) + OUTLINE_PADDING);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const edge = Math.min(x - left, right - x, y - top, bottom - y);
        if (edge < OUTLINE_WIDTH) paint(x, y);
      }
    }
  }
  return { ...panel, data };
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

const compose = (panels, file) => {
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
    const afterPanel = scale(head);
    const panels = [
      ...(base === undefined ? [] : [scale(base)]),
      afterPanel,
      ...(diff === undefined
        ? []
        : [outline(afterPanel, regions(diff, head.width, head.height), head.width / PANEL_WIDTH)]),
    ];
    const labels = base === undefined ? ["after"] : ["before", "after", "changes"];
    if (size !== undefined) {
      panels.unshift(...(pair === undefined ? [] : [scale(pair)]));
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
    `Before is base \`${baseSha.slice(0, 7)}\`, after is head \`${headSha.slice(0, 7)}\`; ${screens(compared)} compared. The changes panel is the after screen with a red box around each changed area; the status bar, the scroll indicators and the top edge of the iOS tab bar's glass are not compared.`,
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
