import { create } from "zustand";
import type { PlayPolicy } from "../domain/write-queue/receipt";

export const usePlayPolicy = create<{ readonly policy: PlayPolicy }>(() => ({ policy: "unknown" }));
