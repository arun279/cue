import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const [directory, horizontalArgument, verticalArgument] = process.argv.slice(2);
const inset = { horizontal: Number(horizontalArgument), vertical: Number(verticalArgument) };

const files = (entry) =>
  statSync(entry).isDirectory()
    ? readdirSync(entry).flatMap((child) => files(path.join(entry, child)))
    : [entry];

const frame = (node) => {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.attributes?.bounds ?? "");
  if (match === null) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
};

const descendants = (node) =>
  (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);

const isButton = (node) => node.clickable === true || /Button$/.test(node.attributes?.class ?? "");

const labels = (button) =>
  descendants(button).filter((node) => (node.attributes?.text ?? "") !== "" && frame(node));

function measure(file) {
  const root = JSON.parse(readFileSync(file, "utf8"));
  const buttons = [root, ...descendants(root)].filter((node) => isButton(node) && frame(node));
  const measured = buttons.filter((button) => labels(button).length > 0);
  const crowded = measured.flatMap((button) => {
    const outer = frame(button);
    return labels(button)
      .filter((label) => {
        const inner = frame(label);
        return (
          inner.left - outer.left < inset.horizontal ||
          outer.right - inner.right < inset.horizontal ||
          inner.top - outer.top < inset.vertical ||
          outer.bottom - inner.bottom < inset.vertical
        );
      })
      .map(
        (label) =>
          `"${label.attributes.text}" ${label.attributes.bounds} in ${button.attributes.bounds}`,
      );
  });
  return {
    file: path.relative(directory, file),
    buttons: buttons.length,
    measured: measured.length,
    crowded,
  };
}

const results = files(directory)
  .filter((file) => file.endsWith(".hierarchy.json"))
  .sort()
  .map(measure);
if (results.length === 0) throw new Error(`no view hierarchies under ${directory}`);

process.stdout.write(
  `| Hierarchy | Buttons | With a label frame | Crowded |\n| --- | ---: | ---: | ---: |\n${results
    .map(
      (result) =>
        `| ${result.file} | ${result.buttons} | ${result.measured} | ${result.crowded.length} |`,
    )
    .join("\n")}\n`,
);
const crowded = results.flatMap((result) =>
  result.crowded.map((label) => `${result.file}: ${label}`),
);
if (crowded.length > 0) {
  throw new Error(
    `labels closer than ${inset.horizontal} horizontal or ${inset.vertical} vertical to their button's edge:\n${crowded.join("\n")}`,
  );
}
