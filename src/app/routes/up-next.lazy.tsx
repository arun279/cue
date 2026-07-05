import { queryKeys } from "@data/query-keys";
import { useQuery } from "@tanstack/react-query";
import { createLazyRoute } from "@tanstack/react-router";
import type { ReactElement } from "react";

const TRAKT_BASE = "https://api.trakt.tv";

/**
 * A lightweight boot probe against Trakt's public catalog. It exists to give the
 * frame one real, persisted query so the SWR boot (instant paint from the
 * restored cache, then revalidate) is exercised end-to-end. A later layer replaces this
 * screen with the real Up Next queue.
 */
async function fetchFrameStatus(): Promise<{ count: number }> {
  const response = await fetch(`${TRAKT_BASE}/networks`, {
    headers: { "trakt-api-version": "2", "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Frame status ${response.status}`);
  const body = (await response.json()) as unknown;
  return { count: Array.isArray(body) ? body.length : 0 };
}

function statusLabel(isFetching: boolean, isError: boolean): string {
  if (isFetching) return "Syncing…";
  if (isError) return "Offline";
  return "Synced";
}

function UpNextScreen(): ReactElement {
  const query = useQuery({ queryKey: queryKeys.frameStatus(), queryFn: fetchFrameStatus });
  const count = query.data?.count ?? 0;

  return (
    <section className="screen" data-testid="screen-up-next">
      <h1 className="screen__title">Up Next</h1>
      <p className="screen__lead">
        The next aired episode of every show you're watching will queue up here.
      </p>
      <p className="status-pill" data-testid="frame-status" data-count={count}>
        {statusLabel(query.isFetching, query.isError)}
      </p>
    </section>
  );
}

export const Route = createLazyRoute("/")({ component: UpNextScreen });
