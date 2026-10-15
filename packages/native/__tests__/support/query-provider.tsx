import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactElement, type ReactNode, useState } from "react";
import { createAppQueryClient } from "../../src/platform/query-client";

export function QueryProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const [client] = useState(() => {
    const client = createAppQueryClient();
    client.setDefaultOptions({ queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } });
    return client;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
