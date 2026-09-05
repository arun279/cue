/**
 * The accessibility ids the end-to-end flows bind to, and the only place they
 * are spelled.
 *
 * Maestro selects by `id`, which it maps to `testID` on both platforms, and text
 * matching is the thing it tells you not to do because a relabelling breaks it.
 * Where a list renders one element per entity the id carries the entity, so a
 * flow survives a sort order changing; where it carries an index, the index is
 * the entity the flow means (the first history row, the first day header).
 *
 * A flow that needs an id not here adds it here first.
 */
export const TEST_IDS = {
  /** Present only when no query is fetching and the durable write queue is
   * empty. Every flow waits on it, so without it a run records a race. */
  appIdle: "app-idle",

  screenOnboarding: "screen-onboarding",
  buttonConnect: "button-connect",
  deviceCodeValue: "device-code-value",

  screenUpNext: "screen-up-next",
  upNextList: "up-next-list",
  upNextSkeleton: "up-next-skeleton",
  marqueeCard: "marquee-card",
  marqueeMark: "marquee-mark",
  queueRow: (traktId: number) => `queue-row-${traktId}`,
  queueRowMark: (traktId: number) => `queue-row-${traktId}-mark`,
  lapsedDrawerToggle: "lapsed-drawer-toggle",
  lapsedRow: (traktId: number) => `lapsed-row-${traktId}`,
  lapsedRowMark: (traktId: number) => `lapsed-row-${traktId}-mark`,
  onTheWayList: "on-the-way-list",
  previouslyList: "previously-list",
  previouslyRowCheck: (index: number) => `previously-row-${index}-check`,
  upNextEmptyNothingQueued: "up-next-empty-nothing-queued",
  upNextEmptyAllCaughtUp: "up-next-empty-all-caught-up",
  upNextEmptyNothingStarted: "up-next-empty-nothing-started",
  upNextEmptyOnlyStopped: "up-next-empty-only-stopped",
  tutorialCaption: "tutorial-caption",

  syncStrip: "sync-strip",
  syncStripOffline: "sync-strip-offline",
  syncStripError: "sync-strip-error",
  refreshIndicator: "refresh-indicator",

  snackbar: "snackbar",
  snackbarMessage: "snackbar-message",
  snackbarUndo: "snackbar-undo",

  confirmSheet: "confirm-sheet",
  confirmSheetPrimary: "confirm-sheet-primary",
  confirmSheetSecondary: "confirm-sheet-secondary",
  confirmSheetCancel: "confirm-sheet-cancel",

  quickActions: "quick-actions",
  quickActionMark: "quick-action-mark",
  quickActionStop: "quick-action-stop",
  quickActionResume: "quick-action-resume",
  quickActionDetails: "quick-action-details",
  quickActionRemovePlay: "quick-action-remove-play",
  quickActionGoTo: "quick-action-go-to",

  tabUpNext: "tab-up-next",
  tabLibrary: "tab-library",
  tabCalendar: "tab-calendar",
  tabSearch: "tab-search",
  tabUpNextActive: "tab-up-next-active",
  tabLibraryActive: "tab-library-active",
  tabCalendarActive: "tab-calendar-active",
  tabSearchActive: "tab-search-active",
  avatarLink: "avatar-link",

  screenLibrary: "screen-library",
  librarySegmentShows: "library-segment-shows",
  librarySegmentMovies: "library-segment-movies",
  libraryChipWatching: "library-chip-watching",
  libraryChipStopped: "library-chip-stopped",
  libraryChipFinished: "library-chip-finished",
  libraryChipWatchlist: "library-chip-watchlist",
  libraryFilterToggle: "library-filter-toggle",
  libraryFilter: "library-filter",
  libraryFilterClear: "library-filter-clear",
  librarySort: "library-sort",
  sortAlphabetical: "sort-alphabetical",
  sortRecentlyWatched: "sort-recently-watched",
  sortRecentlyAdded: "sort-recently-added",
  showCard: (traktId: number) => `show-card-${traktId}`,
  showCardRemaining: (traktId: number) => `show-card-${traktId}-remaining`,
  showCardPaused: (traktId: number) => `show-card-${traktId}-paused`,
  showCardFinished: (traktId: number) => `show-card-${traktId}-finished`,
  movieCard: (traktId: number) => `movie-card-${traktId}`,
  libraryEmpty: "library-empty",

  screenShowDetail: "screen-show-detail",
  showHero: "show-hero",
  continueBar: "continue-bar",
  continueBarCheck: "continue-bar-check",
  seasonList: "season-list",
  seasonTrigger: (season: number) => `season-trigger-${season}`,
  seasonCheck: (season: number) => `season-check-${season}`,
  episodeRow: (traktId: number, season: number, number: number) =>
    `episode-row-${traktId}-${season}-${number}`,
  episodeRowChecked: (traktId: number, season: number, number: number) =>
    `episode-row-${traktId}-${season}-${number}-checked`,
  detailOverflow: "detail-overflow",
  overflowStop: "overflow-stop",
  overflowResume: "overflow-resume",
  overflowWatchlist: "overflow-watchlist",
  overflowMarkWholeShow: "overflow-mark-whole-show",
  overflowTrakt: "overflow-trakt",

  episodeSheet: "episode-sheet",
  episodeSheetClose: "episode-sheet-close",
  episodeMarkRow: "episode-mark-row",
  episodeStillBlur: "episode-still-blur",
  episodeStillReveal: "episode-still-reveal",
  episodeCountdown: "episode-countdown",
  episodePagerNext: "episode-pager-next",
  episodePagerPrev: "episode-pager-prev",
  episodeOverflow: "episode-overflow",
  overflowAddPlay: "overflow-add-play",
  overflowRemoveAll: "overflow-remove-all",

  screenMovieDetail: "screen-movie-detail",
  movieCheck: "movie-check",
  movieOverflow: "movie-overflow",

  screenSearch: "screen-search",
  searchInput: "search-input",
  browseGrid: "browse-grid",
  searchResult: (traktId: number) => `search-result-${traktId}`,
  searchResultWatchlist: (traktId: number) => `search-result-${traktId}-watchlist`,
  searchResultInLibrary: (traktId: number) => `search-result-${traktId}-in-library`,
  searchEmpty: "search-empty",

  screenCalendar: "screen-calendar",
  calendarDayHeaderToday: "calendar-day-header-today",
  calendarDayHeaderTomorrow: "calendar-day-header-tomorrow",
  calendarRow: (traktId: number) => `calendar-row-${traktId}`,
  calendarEmpty: "calendar-empty",

  screenProfile: "screen-profile",
  profileIdentity: "profile-identity",
  profileStatShows: "profile-stat-shows",
  profileStatMovies: "profile-stat-movies",
  profileStatMinutes: "profile-stat-minutes",
  profileEmpty: "profile-empty",
  linkHistory: "link-history",
  linkSettings: "link-settings",
  signOut: "sign-out",
  signOutSheet: "sign-out-sheet",
  signOutConfirm: "sign-out-confirm",
  signOutCancel: "sign-out-cancel",

  screenHistory: "screen-history",
  historyDayHeader: (index: number) => `history-day-header-${index}`,
  historyRow: (index: number) => `history-row-${index}`,
  historyRowCheck: (index: number) => `history-row-${index}-check`,
  historyFilterShows: "history-filter-shows",
  historyFilterMovies: "history-filter-movies",
  historyMonthJump: "history-month-jump",
  historyTitleFilter: "history-title-filter",
  historyEmpty: "history-empty",

  screenSettings: "screen-settings",
  syncNow: "sync-now",
  switchShows: "switch-shows",
  switchShowsOn: "switch-shows-on",
  switchMovies: "switch-movies",
  switchMoviesOn: "switch-movies-on",
  themeSelect: "theme-select",
} as const;
