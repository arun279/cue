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
- **Episode reminders**: an optional daily notification naming what airs that day, scheduled on the phone itself from the calendar Cue already holds. Off until you turn it on, and still no server anywhere.
- **Watchlist**: add shows and movies to your Trakt watchlist, written back through the same optimistic write-queue.

## How it works

Cue is **zero-backend**. It is a browser SPA (with a thin Capacitor shell for mobile) that talks directly to the Trakt API over OAuth using the PKCE flow: there is **no client secret and no server** of any kind. Sync state (history, watchlist, progress) lives in your Trakt account; posters and metadata come from Trakt. Nothing is proxied through a backend because there is no backend.

## Setup

Cue authenticates as a public OAuth client, so it ships **no secret**: the app author registers one Trakt app and embeds its public client id at build time. Users never see or enter a client id; they just sign into their own Trakt account.

1. Register a free API app with Trakt. Current instructions live at [docs.trakt.tv](https://docs.trakt.tv).
2. Set its Redirect URI to `http://localhost:5199/auth/callback` for local development, plus `<your-production-origin>/auth/callback` for deploys. (Trakt matches the redirect URI exactly, so register every origin you serve from.)
3. Copy `packages/web/.env.example` to `packages/web/.env` and set `VITE_TRAKT_CLIENT_ID` to the app's **Client ID**. It is public: it ships in the built JS and there is no client secret.

The client id is public by design. Cue keeps each user's Trakt OAuth token, settings, and a local data cache on-device. Your real `.env` stays local (gitignored); the committed placeholders `.env.example`, `.env.test` and `.env.mock` sit beside it in `packages/web`.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install   # install dependencies
pnpm dev       # start the Vite dev server
pnpm build     # build the static SPA into packages/web/dist/
pnpm check     # run the full deterministic check harness
pnpm e2e       # run the Playwright end-to-end suite
pnpm e2e:mobile # run focused Pixel/Chromium + iPhone/WebKit checks
```

First e2e run only: `pnpm --filter @cue/web exec playwright install chromium webkit`.

Use `pnpm e2e:mobile --headed` when you want to watch the mobile browser checks run.

Every e2e run builds the app and starts its own preview server on port 4173. Set `E2E_PREVIEW_PORT` to move that off the default when a second suite is already running on the same machine.

### Check harness

`pnpm check` is a single deterministic gate that must be green before anything merges. It runs, in order:

- **Biome**: lint and format for JS/TS/JSX/JSON.
- **dprint**: Markdown formatting.
- **cspell**: spelling across TS/TSX/CSS/MD.
- **tsc**: strict TypeScript type-check (`--noEmit`).
- **dependency-cruiser**: layering rules (`@capacitor/*` confined to `packages/web/src/platform`), cruised over every package in one pass.
- **knip**: no unused files, dependencies, or exports.
- **jscpd**: duplicate-code detection.
- **Vitest**: unit tests, one project per package, with coverage thresholds on `domain` and `data`.
- **Vite build**: a production build must compile.

`pnpm e2e` runs the Playwright suite (chromium). `pnpm audit` (high/critical production advisories) is deliberately kept out of `pnpm check` because it reads live advisory state; it runs as its own CI job on every push and on a weekly schedule.

Git hooks are wired with [lefthook](https://lefthook.dev) (`pnpm install` runs `lefthook install`): pre-commit runs the fast gates, pre-push runs `pnpm check`. The full Playwright e2e suite runs in CI (`.github/workflows/ci.yml`, Node 22) on every pull request, and branch protection ruleset 18841630 requires the `e2e` context, so it still gates every merge.

### Local fake Trakt

`scripts/mock-trakt` is a dependency-free Node server that answers the Trakt endpoints Cue reads and writes, seeded with an account that has a queue, a lapsed drawer, upcoming airings, a watchlist and a couple of movies. It exists so the built app can be driven end to end without a Trakt account and without a network: in a browser, and in the iOS simulator, where Playwright route mocking does not exist.

```sh
pnpm mock:trakt # serve the fake Trakt on http://127.0.0.1:8787 (MOCK_TRAKT_PORT overrides the port)
pnpm dev:mock   # run the dev server against it
```

`--mode mock` loads the committed `.env.mock`, which sets a dummy client id and `VITE_TRAKT_API_BASE=http://127.0.0.1:8787`. That variable is the whole switch: unset, which is every shipped build and every other mode, the app talks to `api.trakt.tv` and `trakt.tv`; set, it talks to the mock instead, sign-in included. `pnpm --filter @cue/web exec vite build --mode mock` produces the same thing as a static bundle to preview or to `cap sync` into a shell.

Every write the app makes moves the mock's in-memory account: history marks and their removals (by item, by the bulk season subtree, and by history-play id), hiding and unhiding a show, and watchlist adds and removals. So progress, history, the hidden set, the watchlist and the calendar all stay consistent across a session, and a write naming something the seed does not have comes back in `not_found` rather than as a success the account never took. Any endpoint the mock does not model answers 404 with a logged line rather than an empty success, so a missing fixture reads as a hole instead of an account with nothing in it. Deliberately absent: the browse rails, served as the empty lists a demo account has; search, which is not modelled at all, so typing into it reaches the app's error state rather than an empty one; and rate limiting and failure of any kind, since the mock authorizes anybody and never answers 429. `packages/web/test/harness/mock-trakt.test.ts` boots the mock in-process and reads every seeded endpoint back through the app's own client and zod contracts, which is what keeps the two from drifting.

The Trakt wire shapes are built twice, here and in `packages/web/e2e/helpers.ts`. Both run in Node and either could import the other, so what keeps them apart is the fixtures, not the module boundary: the mock seeds an account (a `library` with a linear `completed` counter, images served from its own origin, per-play watch stamps), while each Playwright spec seeds its own `shows` array with `hidden` and `inWatchlist` flags, serves no images at all, and gates every field on the `extended` level so a request that drops one breaks the suite. Unifying them means reconciling those two seed models, not moving a function. The duplication detector does not report the overlap either way: it reads each package's `src` and `test`.

Reaching it from the iOS simulator needs one thing this branch deliberately does not do: a Debug-only `NSAppTransportSecurity` dictionary in `ios/App/App/Info.plist`, either `NSAllowsLocalNetworking` or an `NSExceptionDomains` entry for `127.0.0.1`, because App Transport Security blocks plaintext HTTP. It must never reach a release build, and `packages/web/test/privacy-claims.test.ts` fails if `NSAppTransportSecurity` appears in the committed `Info.plist` at all.

## Mobile

iOS and Android ship from the same code via [Capacitor](https://capacitorjs.com). The web build in `packages/web/dist/` is the source of truth for everything the user sees; the shells around it are committed, because they are hand-edited: the scene delegate, the bridge controller and the haptics plugin on iOS, the Kotlin haptics plugin and the manifest's permission removal on Android, plus both project files. `cap sync` rewrites the derived parts in place: the web assets it copies (`ios/App/App/public`, `android/app/src/main/assets/public`) and the generated config JSON are the only native paths git ignores, while the plugin manifests it writes (`Package.swift`, `capacitor.settings.gradle`, `capacitor.build.gradle`) are committed, so a plugin appearing or leaving shows up in review.

```sh
pnpm build
pnpm sync              # cap sync
npx cap open ios       # build and run in Xcode (or Android Studio)
```

On device, the Trakt OAuth token is stored via Capacitor Preferences so it survives storage eviction.

Pull down on any of the four tabs to run the same sync as **Settings → Sync now**. Neither shell lends the app a native refresh control (Capacitor turns the iOS web view's bounce off, and Android WebView has no pull gesture), so the gesture lives in the DOM; Settings keeps its row as the tap-only equivalent.

Episode reminders are local notifications and nothing else: one digest each morning for the next two weeks, built on the device from the calendar Cue already reads, with no push service and no server. The Settings switch is the only place the OS notification permission is ever asked for. On Android they use a named channel and inexact alarms only, and `android/app/src/main/AndroidManifest.xml` strips the `SCHEDULE_EXACT_ALARM` permission the notifications plugin would otherwise merge into the app.

### Releasing

`.github/workflows/mobile-release.yml` builds and ships the app: a push to `main` goes to testers (TestFlight and Firebase App Distribution), a `v*` tag submits to the App Store, and a manual dispatch does either on whichever ref it runs against. Every trigger waits on a gate job that re-checks each required CI job for that exact commit, so an unverified commit cannot ship.

A `release/*` branch is the on-demand lane: CI runs on those branches too, so a build can be cut from one without merging it to `main`.

```sh
git branch release/capacitor <sha>
git push origin release/capacitor
gh workflow run mobile-release.yml --ref release/capacitor
```

Build numbers come from that workflow's run counter, which every branch shares and which only increases. That is what makes going back possible: Android refuses a lower `versionCode` and Apple cannot revert an App Store version, so the way back is to dispatch the older ref and let it ship as a new, higher build.

## Tech stack

- **React 19** + **TypeScript** (strict), built with **Vite** (Rolldown).
- **Tailwind CSS v4** (`@theme` tokens) for styling.
- **TanStack Query** (with persistence) and **TanStack Router** for data and routing.
- **TanStack Virtual** for large lists, **Zustand** for local state, **Zod** for runtime boundary validation, **Radix UI** for primitives.
- **Capacitor 8** thin shell for iOS/Android: all `@capacitor/*` imports confined to `packages/web/src/platform`.
- The repository is a pnpm workspace. `packages/web` is the Vite app, layered under `src/domain`, `src/data`, `src/ui`, `src/app`, and `src/platform`; the root carries the gate runner, the native shells and the release lanes.

## Attribution

Powered by [Trakt](https://trakt.tv).

Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt. The app name is deliberately Trakt-free so Cue is never mistaken for an official Trakt product. The unaltered official Trakt logo, from [trakt.tv/branding](https://trakt.tv/branding), appears in the Settings → About credit and ships in `packages/web/src/ui/assets/trakt-logo.svg` (see that folder's README).

## Privacy

Cue runs no server and has no backend of its own, so there is no Cue-side copy of anything: no analytics, no telemetry. It talks to Trakt and to the image hosts Trakt points at, and nowhere else. Your Trakt OAuth token, your settings, anything you have marked that has not synced yet, and a local cache of the data Cue reads are written to this browser or to this device's own app storage. All sync state lives in your own Trakt account, reached directly over HTTPS. The one thing Cue does not control is your phone's own backup service: on Android Cue opts out of Google backup and of Android's own device-to-device transfer, and on iOS Cue has not moved the token off the preferences store yet, which a device backup includes by default; [PRIVACY.md](PRIVACY.md) explains how to turn iCloud Backup off for Cue. To erase Cue's on-device data, use **Settings → Sign out** or uninstall the app. Cue cannot delete your Trakt account; only Trakt can, at [app.trakt.tv/settings/advanced](https://app.trakt.tv/settings/advanced).

The full statement is in [PRIVACY.md](PRIVACY.md).

## License

Cue's own source is licensed under [MIT](LICENSE). The Trakt name and logo are trademarks of Trakt, used under Trakt's [branding guidelines](https://trakt.tv/branding) and are not covered by that license.
