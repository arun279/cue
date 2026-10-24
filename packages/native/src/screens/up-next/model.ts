import type { LibraryEntry } from "@cue/core/data/trakt/library";
import type { UpNextItem } from "@cue/core/domain/up-next";

export interface UpNextCard {
  readonly item: UpNextItem;
  readonly entry: LibraryEntry;
}
