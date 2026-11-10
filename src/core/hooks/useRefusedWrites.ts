import { useIsRestoring, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useRuntime } from "../runtime/runtime";
import { readBackRefused } from "./library-cache";

/**
 * Reads back from Trakt what each refused write showed, once the saved cache has been restored, and
 * saves the cache before the write is forgotten, so a restart cannot bring the refused change back.
 */
export function useRefusedWrites(saveCache: () => Promise<void>): void {
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const restoring = useIsRestoring();
  useEffect(() => {
    if (restoring) return;
    const readBack = readBackRefused(queryClient, runtime);
    return runtime.onRefused(async (op) => {
      await readBack(op);
      await saveCache();
    });
  }, [restoring, queryClient, runtime, saveCache]);
}
