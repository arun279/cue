import { create } from "zustand";
import type { PlayPolicy } from "../domain/play-policy";

export const usePlayPolicy = create<{ readonly policy: PlayPolicy }>(() => ({ policy: "unknown" }));
