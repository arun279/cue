import type { z } from "zod";
import { decode } from "@/core/data/trakt/decode";
import recordings from "./recordings.json" with { type: "json" };

export interface PathShape {
  readonly types: readonly string[];
  readonly classes?: readonly string[];
  readonly number?: "int" | "float";
  readonly always?: boolean;
  readonly empty?: "never" | "sometimes" | "always";
  readonly enum?: readonly string[];
}

export interface EndpointShape {
  readonly statuses: readonly number[];
  readonly paginationHeaders: readonly string[];
  readonly paths: Readonly<Record<string, PathShape>>;
}

export const REAL = recordings.shapes as unknown as Readonly<Record<string, EndpointShape>>;

const STRING_CLASSES: readonly [string, (value: string) => boolean][] = [
  ["empty", (value) => value === ""],
  ["iso-datetime", (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)],
  ["date", (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)],
  ["url", (value) => /^https?:\/\//.test(value)],
  [
    "schemeless-image-path",
    (value) =>
      /^(walter|media|image)[^ ]*\.(jpg|jpeg|png|webp|svg)/i.test(value) ||
      /^[\w.-]+\/[\w./-]+\.(jpg|jpeg|png|webp|svg)$/i.test(value),
  ],
  ["imdb-id", (value) => /^tt\d+$/.test(value)],
  ["numeric-string", (value) => /^\d+$/.test(value)],
  ["hex-color", (value) => /^#[0-9a-f]{6}$/i.test(value)],
  ["hh:mm", (value) => /^\d{2}:\d{2}$/.test(value)],
  ["slug-like", (value) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length < 80],
  [
    "text-non-latin",
    (value) => /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(value),
  ],
];

/** The class a string falls in, the same reduction the recorded shapes went through. */
function classOf(value: string): string {
  return (
    STRING_CLASSES.find(([, matches]) => matches(value))?.[0] ??
    (value.length > 200 ? "text-long" : "text")
  );
}

/** One class for prose of any length: length is not structure. */
export const sameClass = (value: string): string => (value === "text-long" ? "text" : value);

export function templateOf(method: string, path: string): string {
  const template = path
    .replace(/\/seasons\/\d+\/episodes\/\d+$/, "/seasons/:s/episodes/:e")
    .replace(
      /\/calendars\/my\/(shows|movies)\/\d{4}-\d{2}-\d{2}\/\d+$/,
      "/calendars/my/$1/:start/:days",
    )
    .replace(/\/search\/[a-z,]+$/, "/search/:types")
    .replace(/^\/genres\/(shows|movies)$/, "/genres/:type")
    .replace(/\/(shows|movies|episodes)\/(?!:|trending$|popular$)[^/]+(?=\/|$)/g, "/$1/:id");
  return `${method} ${template}`;
}

export interface Observed {
  readonly types: Set<string>;
  readonly classes: Set<string>;
  readonly values: Set<string>;
  present: number;
  objects: number;
  empties: number;
}

export type Summary = Map<string, Observed>;

const typeOf = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

function children(value: unknown, path: string): readonly [string, unknown][] {
  if (Array.isArray(value)) return value.map((item) => [`${path}[]`, item]);
  if (value !== null && typeof value === "object")
    return Object.entries(value).map(([key, child]) => [`${path}.${key}`, child]);
  return [];
}

/** Every path of a body, with the types, string classes and values seen there, and how often. */
export function observe(summary: Summary, path: string, value: unknown): void {
  const node = summary.get(path) ?? {
    types: new Set<string>(),
    classes: new Set<string>(),
    values: new Set<string>(),
    present: 0,
    objects: 0,
    empties: 0,
  };
  summary.set(path, node);
  node.present += 1;
  const type = typeOf(value);
  node.types.add(type);
  if (typeof value === "string") {
    node.classes.add(classOf(value));
    node.values.add(value);
  }
  if (type === "object") node.objects += 1;
  if (Array.isArray(value) && value.length === 0) node.empties += 1;
  for (const [childPath, child] of children(value, path)) observe(summary, childPath, child);
}

export const parentOf = (path: string): string => path.replace(/\.[^.[\]]+$/, "");

const PLACEHOLDER: Readonly<Record<string, string>> = {
  "iso-datetime": "2026-01-01T00:00:00.000Z",
  date: "2026-01-01",
  url: "https://example.invalid/a.jpg",
  "schemeless-image-path": "media.trakt.tv/images/a.jpg",
  "imdb-id": "tt0000001",
  "numeric-string": "1",
  "hex-color": "#000000",
  "hh:mm": "20:00",
  "slug-like": "placeholder",
  "text-non-latin": "テ",
  "text-long": "x".repeat(201),
  text: "Placeholder",
  empty: "",
};

type Paths = Readonly<Record<string, PathShape>>;

const SAMPLES: Readonly<Record<string, (paths: Paths, path: string, shape: PathShape) => unknown>> =
  {
    object: (paths, path) => {
      const prefix = `${path}.`;
      return Object.fromEntries(
        Object.keys(paths)
          .filter((key) => key.startsWith(prefix) && !/[.[]/.test(key.slice(prefix.length)))
          .map((key) => [key.slice(prefix.length), sampleOf(paths, key)]),
      );
    },
    array: (paths, path) =>
      paths[`${path}[]`] === undefined ? [] : [sampleOf(paths, `${path}[]`)],
    string: (_paths, _path, shape) => shape.enum?.[0] ?? PLACEHOLDER[shape.classes?.[0] ?? "text"],
    number: () => 1,
    boolean: () => true,
  };

/** A body with every path the shape knows, each filled with a placeholder of its type. */
function sampleOf(paths: Paths, path: string): unknown {
  const shape = paths[path];
  if (shape === undefined) return undefined;
  const sample = SAMPLES[shape.types.find((type) => type !== "null") ?? "null"];
  return sample === undefined ? null : sample(paths, path, shape);
}

/**
 * The paths the app keeps after decoding: the app's own schema strips the rest,
 * so feeding it a body with every recorded path and reading back what survives
 * names exactly the fields it reads.
 */
export function pathsTheAppReads(schema: z.ZodType | undefined, shape: EndpointShape): Set<string> {
  const into = new Set<string>();
  if (schema === undefined) return into;
  const decoded = decode(schema, sampleOf(shape.paths, ""));
  if (!decoded.ok) return into;
  const visit = (value: unknown, path: string): void => {
    into.add(path);
    for (const [childPath, child] of children(value, path))
      if (child !== undefined) visit(child, childPath);
  };
  visit(decoded.data, "");
  return into;
}
