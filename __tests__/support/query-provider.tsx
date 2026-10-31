import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactElement, type ReactNode, useState } from "react";
import { type CueRuntime, RuntimeProvider } from "@/core/runtime/runtime";
import { createAppQueryClient } from "../../src/platform/query-client";

export function QueryProvider({
  runtime,
  children,
}: {
  readonly runtime?: CueRuntime;
  readonly children: ReactNode;
}): ReactElement {
  const [client] = useState(() => {
    const client = createAppQueryClient();
    client.setDefaultOptions({ queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } });
    return client;
  });
  return (
    <QueryClientProvider client={client}>
      {runtime === undefined ? (
        children
      ) : (
        <RuntimeProvider value={runtime}>{children}</RuntimeProvider>
      )}
    </QueryClientProvider>
  );
}
