import { readFileSync } from "node:fs";

const [file, horizontalArgument, verticalArgument, densityArgument] = process.argv.slice(2);
const scale = Number(densityArgument) / 160;
if (!(scale > 0)) throw new Error(`density must be a positive dpi, got "${densityArgument}"`);
const inset = {
  horizontal: Number(horizontalArgument) * scale,
  vertical: Number(verticalArgument) * scale,
};

function parse(xml) {
  const root = { attributes: {}, children: [] };
  const stack = [root];
  for (const [tag, attributes = "", selfClosing] of xml.matchAll(
    /<node\b([^>]*?)(\/?)>|<\/node>/g,
  )) {
    if (tag === "</node>") {
      stack.pop();
      continue;
    }
    const node = {
      attributes: Object.fromEntries(
        [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => match.slice(1)),
      ),
      children: [],
    };
    stack.at(-1).children.push(node);
    if (selfClosing === "") stack.push(node);
  }
  return root;
}

const frame = (node) => {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.attributes.bounds ?? "");
  if (match === null) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
};

const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);

// uiautomator reports only the visible part of a view cut by its scroll container's edge.
const clipped = new Set();
const markClipped = (node, viewport = null) => {
  const bounds = frame(node);
  if (bounds !== null && viewport?.edges.some((edge) => bounds[edge] === viewport.frame[edge])) {
    clipped.add(node);
  }
  const scrolls = node.attributes.scrollable === "true" && frame(node) !== null;
  const edges = /Horizontal/.test(node.attributes.class ?? "")
    ? ["left", "right"]
    : ["top", "bottom"];
  for (const child of node.children) {
    markClipped(child, scrolls ? { frame: frame(node), edges } : viewport);
  }
};

const isButton = (node) =>
  node.attributes.clickable === "true" || /Button$/.test(node.attributes.class ?? "");

const labels = (button) =>
  descendants(button).filter((node) => (node.attributes.text ?? "") !== "" && frame(node));

const crowds = (outer, inner) =>
  inner.left - outer.left < inset.horizontal ||
  outer.right - inner.right < inset.horizontal ||
  inner.top - outer.top < inset.vertical ||
  outer.bottom - inner.bottom < inset.vertical;

const screen = parse(readFileSync(file, "utf8"));
markClipped(screen);
const measured = descendants(screen).filter(
  (node) => isButton(node) && !clipped.has(node) && frame(node) && labels(node).length > 0,
);
const crowded = measured.flatMap((button) =>
  labels(button)
    .filter((label) => crowds(frame(button), frame(label)))
    .map(
      (label) =>
        `"${label.attributes.text}" ${label.attributes.bounds} in ${button.attributes.bounds}`,
    ),
);

process.stdout.write(
  `Measured ${measured.length} labelled buttons; ${crowded.length} crowd their edge.\n`,
);
if (measured.length === 0) throw new Error(`no labelled button to measure in ${file}`);
if (crowded.length > 0) {
  throw new Error(
    `labels closer than ${horizontalArgument} dp across or ${verticalArgument} dp down to their button's edge:\n${crowded.join("\n")}`,
  );
}
