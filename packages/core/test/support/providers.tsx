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
