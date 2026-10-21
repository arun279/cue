import { REPLACED_COPY } from "@cue/core/hooks/replaced-copy";
import { snackText } from "@cue/core/stores/snackbar-store";
import { expect, it } from "vitest";

it("names the episode for a show and nothing extra for a movie", () => {
  expect(snackText(REPLACED_COPY.mark("A Show", "S1 E2"))).toBe(
    "A Show S1 E2 was already watched. Trakt changed its watch date to now.",
  );
  expect(snackText(REPLACED_COPY.mark("A Film", null))).toBe(
    "A Film was already watched. Trakt changed its watch date to now.",
  );
});

it("counts changed watch dates in the singular and the plural", () => {
  expect(REPLACED_COPY.bulk("Season 2 marked · 3 episodes", 1)).toBe(
    "Season 2 marked · 3 episodes. Watch date changed for 1 already watched.",
  );
  expect(REPLACED_COPY.bulk("Season 2 marked · 3 episodes", 2)).toBe(
    "Season 2 marked · 3 episodes. Watch dates changed for 2 already watched.",
  );
  expect(REPLACED_COPY.rewatch("Season 3 marked again", 19, 5)).toBe(
    "Season 3 marked again · 19 added, 5 watch dates changed",
  );
});
