import { useQuery } from "@tanstack/react-query";
import { genreNamesQuery } from "../queries/genres";
import { useRuntime } from "../runtime/runtime";

const NO_NAMES: Readonly<Record<string, string>> = {};

const titleCase = (slug: string): string =>
  slug.replace(
    /(^|-)(\w)/g,
    (_, dash: string, letter: string) => `${dash && " "}${letter.toUpperCase()}`,
  );

export function useGenreLabels(slugs: readonly string[]): readonly string[] {
  const runtime = useRuntime();
  const { data = NO_NAMES } = useQuery({ ...genreNamesQuery(runtime), enabled: slugs.length > 0 });
  return slugs.map((slug) => data[slug] ?? titleCase(slug));
}
