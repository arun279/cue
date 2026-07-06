# Cue

Cue is a personal, zero-backend TV and movie tracker that syncs to your own [Trakt](https://trakt.tv) account. It is a TV and movie tracker — your Up Next queue, show library, calendar, and viewing stats — without the social feed, the ads, or a server in the middle. Your account, your data, running entirely on your own device and against your own Trakt app.

## Features

- **Up Next** — a poster-first queue of the next episode to watch across every show you follow, with one-tap mark-as-watched (optimistic, undoable, durable through offline).
- **My Shows** — your full library bucketed by status (watching, up next, upcoming, ended), backed by a virtualized poster grid.
- **Show and Episode detail** — season shelves with per-season and per-episode marking, a cinematic still, and inline ratings.
- **Calendar** — upcoming episodes for the shows you track.
- **Discover** — debounced search with inline add, plus browse rails.
- **Profile** — viewing stats tiles built from your Trakt history.
- **Watchlist and ratings** — add to your Trakt watchlist and rate shows and episodes, written back through an optimistic write-queue.

## How it works

Cue is **zero-backend**. It is a browser SPA (with a thin Capacitor shell for mobile) that talks directly to the Trakt API over OAuth using the PKCE flow — there is **no client secret and no server** of any kind. Sync state (history, watchlist, ratings, progress) lives in your Trakt account; artwork and metadata come optionally from [TMDB](https://www.themoviedb.org) for higher-resolution art. Nothing is proxied through a backend because there is no backend.

## Setup

Cue authenticates as a public OAuth client, so it needs no committed secrets — you provide your own credentials at runtime:

1. Register a free API app at [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications).
2. Add the redirect URI `<your-origin>/auth/callback` (for local development that is `http://localhost:5173/auth/callback`).
3. Launch Cue and paste your Trakt **Client ID** on first run. No client secret is required or used.
4. _(Optional)_ Add a free [TMDB](https://www.themoviedb.org/settings/api) API key for higher-resolution posters and stills.

Credentials are entered at runtime and stored on-device only — never committed to the repo or baked into the build.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install   # install dependencies
pnpm dev       # start the Vite dev server
pnpm build     # build the static SPA into dist/
pnpm check     # run the full deterministic check harness
pnpm e2e       # run the Playwright end-to-end suite
```

First e2e run only: `pnpm exec playwright install chromium`.

### Check harness

`pnpm check` is a single deterministic gate that must be green before anything merges. It runs, in order:

- **Biome** — lint and format for JS/TS/JSX/JSON.
- **dprint** — Markdown formatting.
- **cspell** — spelling across TS/TSX/CSS/MD.
- **tsc** — strict TypeScript type-check (`--noEmit`).
- **dependency-cruiser** — layering rules (`@capacitor/*` confined to `src/platform`).
- **knip** — no unused files, dependencies, or exports.
- **jscpd** — duplicate-code detection.
- **Vitest** — unit tests with coverage thresholds on `src/domain` and `src/data`.
- **Vite build** — a production build must compile.

`pnpm e2e` runs the Playwright suite (chromium). `pnpm audit` (high/critical production advisories) is deliberately kept out of `pnpm check` because it reads live advisory state; it runs as its own CI job on every push and on a weekly schedule.

Git hooks are wired with [lefthook](https://lefthook.dev) (`pnpm install` runs `lefthook install`): pre-commit runs the fast gates, pre-push runs the full `pnpm check` and `pnpm e2e`. The same gates run in CI (`.github/workflows/ci.yml`) on Node 22.

## Mobile

iOS and Android ship from the same code via [Capacitor](https://capacitorjs.com). The web build in `dist/` is the source of truth; the native projects are generated, not committed.

```sh
pnpm build
npx cap add ios        # or: npx cap add android
pnpm sync              # cap sync
npx cap open ios       # build and run in Xcode (or Android Studio)
```

On device, credentials are stored via Capacitor Preferences so they survive storage eviction.

## Tech stack

- **React 19** + **TypeScript** (strict), built with **Vite** (Rolldown).
- **Tailwind CSS v4** (`@theme` tokens) for styling.
- **TanStack Query** (with persistence) and **TanStack Router** for data and routing.
- **TanStack Virtual** for large lists, **Zustand** for local state, **Zod** for runtime boundary validation, **Radix UI** for primitives.
- **Capacitor 8** thin shell for iOS/Android — all `@capacitor/*` imports confined to `src/platform`.
- Source is layered under `src/domain`, `src/data`, `src/ui`, `src/app`, and `src/platform`.

## Privacy

Nothing is stored server-side because there is no server. Your Trakt tokens, your TMDB key, and your settings live only in the browser or on the device. All sync state lives in your own Trakt account, reached directly over HTTPS.

## License

[MIT](LICENSE)
