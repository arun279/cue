export type GenreNames = Readonly<Record<string, string>>;

export function genreNames(
  genres: readonly { readonly name: string; readonly slug: string }[],
): GenreNames {
  return Object.fromEntries(genres.map((genre) => [genre.slug, genre.name]));
}

export function genreLabel(slug: string, names: GenreNames): string {
  return (
    names[slug] ??
    slug
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}
