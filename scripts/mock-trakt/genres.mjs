const MOVIE_GENRES = [
  "Action",
  "Adventure",
  "Animation",
  "Anime",
  "Comedy",
  "Crime",
  "Documentary",
  "Donghua",
  "Drama",
  "Family",
  "Fantasy",
  "History",
  "Holiday",
  "Horror",
  "Music",
  "Musical",
  "Mystery",
  "None",
  "Romance",
  "Science Fiction",
  "Short",
  "Sporting Event",
  "Superhero",
  "Suspense",
  "Thriller",
  "War",
  "Western",
];
const SHOW_ONLY_GENRES = [
  "Biography",
  "Children",
  "Game Show",
  "Home And Garden",
  "Mini Series",
  "News",
  "Reality",
  "Soap",
  "Special Interest",
  "Talk Show",
];

const genre = (name) => ({ name, slug: name.toLowerCase().replaceAll(" ", "-") });

/** Trakt's `/genres/:type` lists, in its order. */
export const GENRES = {
  movies: MOVIE_GENRES.map(genre),
  shows: [...MOVIE_GENRES, ...SHOW_ONLY_GENRES].sort().map(genre),
};
