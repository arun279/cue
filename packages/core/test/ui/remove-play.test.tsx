// @vitest-environment jsdom
import type { HistoryEntry } from "@cue/core/domain/history";
import type { QueuedOp } from "@cue/core/domain/write-queue/types";
import { type RemovePlayController, useRemovePlay } from "@cue/core/hooks/useRemovePlay";
import { type CueRuntime, RuntimeProvider } from "@cue/core/runtime/runtime";
import { dismissSnack, useSnackbar } from "@cue/core/stores/snackbar-store";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "./_mount";

const entry: HistoryEntry = {
  historyId: 44,
  watchedAt: "2026-08-01T12:00:00.000Z",
  type: "movie",
  mediaId: 9,
  ids: { trakt: 9 },
  title: "Harbor",
  year: 2026,
  season: null,
  number: null,
  episodeTitle: null,
  posters: [],
  tmdbId: null,
};

function Probe({ slot }: { readonly slot: RemovePlayController[] }): null {
  slot[0] = useRemovePlay();
  return null;
}

function setup(): { readonly slot: RemovePlayController[]; readonly submitted: QueuedOp[] } {
  const submitted: QueuedOp[] = [];
  const runtime = {
    newId: () => `op-${submitted.length}`,
    submit: (op: QueuedOp) => {
      submitted.push(op);
      return Promise.resolve("deferred");
    },
  } as unknown as CueRuntime;
  const slot: RemovePlayController[] = [];
  mount(
    <QueryClientProvider client={new QueryClient()}>
      <RuntimeProvider value={runtime}>
        <Probe slot={slot} />
      </RuntimeProvider>
    </QueryClientProvider>,
  );
  return { slot, submitted };
}

beforeEach(dismissSnack);

describe("useRemovePlay", () => {
  it("hides one exact play and restores it through the snackbar action", async () => {
    const { slot, submitted } = setup();

    await act(async () => slot[0]?.removePlay(entry));
    expect(slot[0]?.removedIds).toEqual(new Set([44]));
    expect(submitted[0]?.request.body).toEqual({ ids: [44] });

    await act(async () => {
      useSnackbar.getState().snack?.actions?.[0]?.onPress();
      await Promise.resolve();
    });
    expect(slot[0]?.removedIds).toEqual(new Set());
    expect(submitted[1]?.request.path).toBe("/sync/history");
  });
});
