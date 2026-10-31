import type { LibraryEntry } from "@/core/domain/model/library";
import type { UpNextItem } from "@/core/domain/up-next";

export interface UpNextCard {
  readonly item: UpNextItem;
  readonly entry: LibraryEntry;
}
