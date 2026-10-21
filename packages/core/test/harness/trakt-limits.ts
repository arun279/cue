// AUTHED_API_GET_LIMIT, per user across all of that user's devices:
// https://developer.trakt.tv/docs/rate-limiting and https://github.com/trakt/trakt-api/issues/909
const TRAKT_GETS_PER_WINDOW = 500;

// One user action may spend a fifth of the window. Four such actions in five minutes (a launch on
// a phone and on a tablet, a relaunch after the OS ends the app, a full scroll) plus both devices'
// one-a-minute activity polls still leave 90 GETs for read retries.
export const SCENARIO_GET_BUDGET = TRAKT_GETS_PER_WINDOW / 5;
