import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { type CueRuntime, RuntimeProvider } from "@/core/runtime/runtime";
import { useSnackbar } from "@/core/stores/snackbar-store";

export const withRuntime =
  (runtime: CueRuntime, client: QueryClient) =>
  ({ children }: { readonly children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>{children}</RuntimeProvider>
    </QueryClientProvider>
  );

/**
 * A runtime with only the members a suite exercises, typed so a stub matches the real signature.
 * It refuses no write unless the suite says so.
 */
export const partialRuntime = (members: Partial<CueRuntime>): CueRuntime =>
  ({ onRefused: () => () => {}, ...members }) as CueRuntime;

/** Presses Undo on the snack on screen, as the person would; resolves once the Undo is done. */
export async function pressUndo(): Promise<void> {
  await useSnackbar
    .getState()
    .snack?.actions?.find((action) => action.label === "Undo")
    ?.onPress();
}
