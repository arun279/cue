import { useQuery } from "@tanstack/react-query";
import { hiddenShowIdsOf } from "../domain/calendar";
import { libraryQuery } from "../queries/library";
import { type UpNextData, useRuntime } from "../runtime/runtime";

const NONE: ReadonlySet<number> = new Set();

const selectHidden = (data: UpNextData): ReadonlySet<number> => hiddenShowIdsOf(data.entries);

export function useHiddenShowIds(enabled: boolean): ReadonlySet<number> {
  const runtime = useRuntime();
  return useQuery({ ...libraryQuery(runtime), enabled, select: selectHidden }).data ?? NONE;
}
