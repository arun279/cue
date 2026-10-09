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

const isButton = (node) =>
  node.attributes.clickable === "true" || /Button$/.test(node.attributes.class ?? "");

const labels = (button) =>
  descendants(button).filter((node) => (node.attributes.text ?? "") !== "" && frame(node));

const crowds = (outer, inner) =>
  inner.left - outer.left < inset.horizontal ||
  outer.right - inner.right < inset.horizontal ||
  inner.top - outer.top < inset.vertical ||
  outer.bottom - inner.bottom < inset.vertical;

const measured = descendants(parse(readFileSync(file, "utf8"))).filter(
  (node) => isButton(node) && frame(node) && labels(node).length > 0,
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
