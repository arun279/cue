import type { LibraryEntry } from "@/core/data/trakt/library";
import type { UpNextItem } from "@/core/domain/up-next";

export interface UpNextCard {
  readonly item: UpNextItem;
  readonly entry: LibraryEntry;
}
