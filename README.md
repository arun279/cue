# Cue

Cue is a personal, zero-backend TV and movie tracker that syncs to your own [Trakt](https://trakt.tv) account. It is a TV and movie tracker (your Up Next queue, show library, calendar, and viewing stats) without the social feed, the ads, or a server in the middle. Your account, your data, running entirely on your own device and synced to your own Trakt account.

## Features

Four tabs: Up Next, Library, Calendar, Search, with History, Profile, and Settings behind the header avatar.

- **Up Next**: the home timeline. A marquee spotlight on the show to resume, the queue of next episodes, an "On the way" shelf for episodes with an air date, a "Haven't watched lately" drawer for idle shows, and "Previously" for what you just watched.
- **One-tap marking**: optimistic mark-as-watched everywhere (tap the check, or swipe a row), batched into a single snackbar Undo and durable through offline via a write-queue.
- **Library**: every show and movie you track behind status chips (Watching, Watchlist, Stopped, Finished), on a virtualized poster grid with filter and sort.
- **Calendar**: the upcoming agenda for your shows, day by day with countdown chips.
- **Search**: debounced show and movie search with inline watchlist add, and trending/popular browse grids while idle.
- **Show, episode, and movie detail**: season shelves with per-episode ticks, bulk "mark up to here" and season marking, and an episode bottom sheet with spoiler-guarded stills (unwatched artwork stays hidden until revealed; the guard can be turned off in Settings).
- **History and Profile**: viewing stats tiles and the full watch log, browsable by year and month, with per-play removal.
- **Watchlist**: add shows and movies to your Trakt watchlist, written back through the same optimistic write-queue.

## How it works

Cue is **zero-backend**. It is a browser SPA (with a thin Capacitor shell for mobile) that talks directly to the Trakt API over OAuth using the PKCE flow: there is **no client secret and no server** of any kind. Sync state (history, watchlist, progress) lives in your Trakt account; posters and metadata come from Trakt. Nothing is proxied through a backend because there is no backend.

## Setup

Cue authenticates as a public OAuth client, so it ships **no secret**: the app author registers one Trakt app and embeds its public client id at build time. Users never see or enter a client id; they just sign into their own Trakt account.

1. Register a free API app at [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications).
2. Set its Redirect URI to `http://localhost:5199/auth/callback` for local development, plus `<your-production-origin>/auth/callback` for deploys. (Trakt matches the redirect URI exactly, so register every origin you serve from.)
3. Copy `.env.example` to `.env` and set `VITE_TRAKT_CLIENT_ID` to the app's **Client ID**. It is public: it ships in the built JS and there is no client secret.

The client id is public by design. Cue keeps each user's Trakt OAuth token, settings, and a local data cache on-device. Your real `.env` stays local (gitignored); `.env.example` and `.env.test` are the committed placeholders.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install   # install dependencies
pnpm dev       # start the Vite dev server
pnpm build     # build the static SPA into dist/
pnpm check     # run the full deterministic check harness
pnpm e2e       # run the Playwright end-to-end suite
pnpm e2e:mobile # run focused Pixel/Chromium + iPhone/WebKit checks
```

First e2e run only: `pnpm exec playwright install chromium webkit`.

Use `pnpm e2e:mobile --headed` when you want to watch the mobile browser checks run.

### Check harness

`pnpm check` is a single deterministic gate that must be green before anything merges. It runs, in order:

- **Biome**: lint and format for JS/TS/JSX/JSON.
- **dprint**: Markdown formatting.
- **cspell**: spelling across TS/TSX/CSS/MD.
- **tsc**: strict TypeScript type-check (`--noEmit`).
- **dependency-cruiser**: layering rules (`@capacitor/*` confined to `src/platform`).
- **knip**: no unused files, dependencies, or exports.
- **jscpd**: duplicate-code detection.
- **Vitest**: unit tests with coverage thresholds on `src/domain` and `src/data`.
- **Vite build**: a production build must compile.

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

On device, the Trakt OAuth token is stored via Capacitor Preferences so it survives storage eviction.

## Tech stack

- **React 19** + **TypeScript** (strict), built with **Vite** (Rolldown).
- **Tailwind CSS v4** (`@theme` tokens) for styling.
- **TanStack Query** (with persistence) and **TanStack Router** for data and routing.
- **TanStack Virtual** for large lists, **Zustand** for local state, **Zod** for runtime boundary validation, **Radix UI** for primitives.
- **Capacitor 8** thin shell for iOS/Android: all `@capacitor/*` imports confined to `src/platform`.
- Source is layered under `src/domain`, `src/data`, `src/ui`, `src/app`, and `src/platform`.

## Attribution

Powered by [Trakt](https://trakt.tv).

Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt. The app name is deliberately Trakt-free so Cue is never mistaken for an official Trakt product. The unaltered official Trakt logo, from [trakt.tv/branding](https://trakt.tv/branding), appears in the Settings → About credit and ships in `src/ui/assets/trakt-logo.svg` (see that folder's README).

## Privacy

Cue runs no server and has no backend of its own, so there is no Cue-side copy of anything: no analytics, no telemetry. It talks to Trakt and to the image hosts Trakt points at, and nowhere else. Your Trakt OAuth token, your settings, anything you have marked that has not synced yet, and a local cache of the data Cue reads are written to this browser or to this device's own app storage. All sync state lives in your own Trakt account, reached directly over HTTPS. The one thing Cue does not control is your phone's own backup service: on Android Cue opts out of Google backup and of Android's own device-to-device transfer, and on iOS Cue has not moved the token off the preferences store yet, which a device backup includes by default; [PRIVACY.md](PRIVACY.md) explains how to turn iCloud Backup off for Cue. To erase Cue's on-device data, use **Settings → Sign out** or uninstall the app. Cue cannot delete your Trakt account; only Trakt can, at [app.trakt.tv/settings/advanced](https://app.trakt.tv/settings/advanced).

The full statement is in [PRIVACY.md](PRIVACY.md).

## License

Cue's own source is licensed under [MIT](LICENSE). The Trakt name and logo are trademarks of Trakt, used under Trakt's [branding guidelines](https://trakt.tv/branding) and are not covered by that license.
