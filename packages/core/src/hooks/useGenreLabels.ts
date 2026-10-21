import { useQuery } from "@tanstack/react-query";
import { genreLabel } from "../domain/genres";
import { genreNamesQuery } from "../queries/genres";
import { useRuntime } from "../runtime/runtime";

const NO_NAMES = {};

export function useGenreLabels(slugs: readonly string[]): readonly string[] {
  const runtime = useRuntime();
  const { data = NO_NAMES } = useQuery({ ...genreNamesQuery(runtime), enabled: slugs.length > 0 });
  return slugs.map((slug) => genreLabel(slug, data));
}
