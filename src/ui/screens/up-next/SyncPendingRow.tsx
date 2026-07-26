import { applyLibraryProgress, type LibraryEntry } from "@data/trakt/library";
import { useQueryClient } from "@tanstack/react-query";
import { CheckControl } from "@ui/components/CheckControl";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { ProgressBar } from "@ui/components/ProgressBar";
import { patchLibraryEntry } from "@ui/hooks/library-cache";
import { useShowArt } from "@ui/hooks/useShowArt";
import { useShowProgress } from "@ui/hooks/useShowProgress";
import { type ReactElement, useEffect } from "react";
import { Poster } from "./Poster";

interface SyncPendingRowProps {
  readonly entry: LibraryEntry;
  readonly visible: boolean;
}

/** A budget-tail row that promotes itself as soon as its visible progress read resolves. */
export function SyncPendingRow({ entry, visible }: SyncPendingRowProps): ReactElement {
  const queryClient = useQueryClient();
  const art = useShowArt(entry.showId);
  const progress = useShowProgress(entry.showId, visible);

  useEffect(() => {
    const data = progress.data;
    if (data === undefined || !progress.isFetchedAfterMount) return;
    patchLibraryEntry(queryClient, entry.showId, (current) => applyLibraryProgress(current, data));
  }, [entry.showId, progress.data, progress.isFetchedAfterMount, queryClient]);

  // A row still waiting its turn and a row mid-read are the same thing to the
  // reader: progress that hasn't landed yet. Only a settled failure earns its own
  // surface, so the shimmer and the check never blink out from under the user.
  const state =
    progress.isError && !progress.isFetching
      ? {
          meta: "Couldn't load progress.",
          linkLabel: `${entry.title}, Progress unavailable`,
          footer: undefined,
          trailing: (
            <button
              type="button"
              className="sync-pending__retry"
              data-testid="sync-pending-retry"
              onClick={progress.refetch}
            >
              Retry
            </button>
          ),
        }
      : {
          meta: "Syncing progress…",
          linkLabel: `${entry.title}, Syncing progress`,
          footer: <ProgressBar striped />,
          trailing: <CheckControl state="syncing" size={48} label="" />,
        };

  const posters = art.posters.length > 0 ? art.posters : entry.posters;
  return (
    <EpisodeRow
      variant="queue"
      testId="sync-pending-row"
      showId={entry.showId}
      art={<Poster title={entry.title} posters={posters} variant="s48" />}
      title={entry.title}
      meta={state.meta}
      footer={state.footer}
      trailing={state.trailing}
      link={{ to: "/show/$showId", params: { showId: String(entry.showId) } }}
      linkLabel={state.linkLabel}
    />
  );
}
