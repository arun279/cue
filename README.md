# Cue

Cue is a personal, zero-backend TV and movie tracker for iOS and Android. It syncs directly to your own [Trakt](https://trakt.tv) account and keeps the Up Next queue, library, calendar, history, and viewing stats focused on what you want to watch.

## Features

- Up Next with a spotlight, next episodes, upcoming airings, idle shows, and recent history.
- Optimistic mark-as-watched actions with batch undo and a durable offline write queue.
- Show and movie libraries with filtering, sorting, watchlist actions, and detail views.
- Calendar, search, history, profile statistics, and local episode reminders.
- Spoiler-aware episode artwork and per-play history removal.

## How it works

Cue has no backend of its own. The Expo app talks directly to Trakt over OAuth with a public client id and no client secret. Sync state lives in Trakt; tokens, preferences, queued writes, and cached data stay in the app's on-device storage.

## Development

Requires Node 22 or newer and pnpm.

```sh
pnpm install
pnpm dev
pnpm check
```

Set `EXPO_PUBLIC_TRAKT_CLIENT_ID` to the public client id of a Trakt API app. The native projects are generated from `packages/native/app.config.ts` and its config plugins:

```sh
pnpm --filter @cue/native prebuild
```

`pnpm check` is the deterministic repository gate. It runs Biome, dprint, cspell, TypeScript, dependency-cruiser, knip, jscpd, quality and suppression ratchets, native size and asset checks, Vitest with coverage, and the iOS and Android jest-expo projects. The native bundle ceilings, per-PR delta gate, Play download ceiling, and asset allowlist are enforced independently.

Git hooks are installed by `pnpm install`. Pre-commit runs the fast formatting, spelling, type, and portability gates. Pre-push runs `pnpm check`.

## Local fake Trakt

`scripts/mock-trakt` is a dependency-free server for deterministic sync tests and native simulator flows. It serves seeded accounts, records request journals, and exposes controlled rate-limit, server failure, token refresh, delayed response, held connection, and dropped connection modes.

```sh
pnpm mock:trakt
```

The core harness boots the server in process and drives `@cue/core` through its real client, read pool, query cache, runtime, and write queue. This keeps request budgets, retry timing, refresh behavior, request shapes, and post-write scoped reads independent of any rendered screen. Maestro flows drive the Expo app against the same fake service.

Set `EXPO_PUBLIC_TRAKT_API_BASE=http://127.0.0.1:8787` for a simulator build that should use the fake service. The Expo configuration adds a local transport exception only for that build. Release builds carry no exception.

## Architecture

The pnpm workspace has two packages:

- `@cue/core` in `packages/core` owns the domain, Trakt data layer, durable write queue, hooks, stores, preferences, runtime, and platform ports. It is TypeScript source with no build step and no dependency on Expo or React Native.
- `@cue/native` in `packages/native` is the Expo app. Its `app` directory contains the expo-router routes, `src` contains UI and platform adapters, `modules/cue-native` contains the local Expo module, and `plugins` contains config plugins.

Dependencies flow from the Expo app into the core. Dependency-cruiser enforces that boundary, keeps the domain and data layers narrow, and requires every Trakt read to use the shared pool.

## Testing

Core tests use Vitest with coverage thresholds of 90/90/90/80 for the domain, data, preferences, URL, and stores layers, plus a ratchet for hooks and a global floor. Repository-level workflow and size checks live in `test/ci`. The Expo app uses jest-expo for both platform presets and Maestro for simulator flows.

## Releasing

`.github/workflows/mobile-release.yml` builds and ships the app. A push to `main` goes to testers, a `v*` tag submits to the App Store, and a manual dispatch can run either lane. Each release waits for the required CI checks on the exact commit being shipped.

## Attribution

Powered by [Trakt](https://trakt.tv).

Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt. The app name is deliberately Trakt-free so Cue is never mistaken for an official Trakt product. The official Trakt logo is used in the Settings credit under Trakt's branding guidelines.

## Privacy

Cue runs no server and collects no analytics or telemetry. It talks to Trakt and the image hosts Trakt references. Your OAuth token, settings, queued marks, and cache stay on your device. See [PRIVACY.md](PRIVACY.md) for backup behavior and deletion instructions.

## License

Cue's source is licensed under [MIT](LICENSE). The Trakt name and logo are trademarks of Trakt and are not covered by that license.
