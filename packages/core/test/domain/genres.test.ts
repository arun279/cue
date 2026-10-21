import { genreLabel, genreNames } from "@cue/core/domain/genres";
import { expect, it } from "vitest";

const names = genreNames([
  { name: "Science Fiction", slug: "science-fiction" },
  { name: "Reality", slug: "reality" },
]);

it("names a genre the way Trakt names it", () => {
  expect(genreLabel("science-fiction", names)).toBe("Science Fiction");
  expect(genreLabel("reality", names)).toBe("Reality");
});

it("title-cases a slug Trakt's list does not carry, with hyphens as spaces", () => {
  expect(genreLabel("home-and-garden", names)).toBe("Home And Garden");
  expect(genreLabel("science-fiction", {})).toBe("Science Fiction");
});
