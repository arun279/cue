import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";

export const withRuntime =
  (runtime: CueRuntime, client: QueryClient) =>
  ({ children }: { readonly children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>
      <RuntimeProvider value={runtime}>{children}</RuntimeProvider>
    </QueryClientProvider>
  );

/** A runtime with only the members a suite exercises, typed so a stub matches the real signature. */
export const partialRuntime = (members: Partial<CueRuntime>): CueRuntime => members as CueRuntime;
