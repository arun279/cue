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

Set `EXPO_PUBLIC_TRAKT_API_BASE=http://127.0.0.1:8787` for a simulator build that should use the fake service. The Expo configuration adds a local transport exception only for that build. Release builds carry no exception. Set `EXPO_PUBLIC_UI_HARNESS=1` as well for a build that Maestro drives: it bundles the readiness and timing markers the flows read. Without it, Metro resolves `src/ui/harness.tsx` to an empty stand-in, and `pnpm check:size:native` and the update workflow fail if a harness module reaches an exported bundle.

## Architecture

The pnpm workspace has two packages:

- `@cue/core` in `packages/core` owns the domain, Trakt data layer, durable write queue, hooks, stores, preferences, runtime, and platform ports. It is TypeScript source with no build step and no dependency on Expo or React Native.
- `@cue/native` in `packages/native` is the Expo app. Its `app` directory contains the expo-router routes, `src` contains UI and platform adapters, `modules/cue-native` contains the local Expo module, and `plugins` contains config plugins.

Dependencies flow from the Expo app into the core. Dependency-cruiser enforces that boundary, keeps the domain and data layers narrow, and requires every Trakt read to use the shared pool.

## Testing

Core tests use Vitest with coverage thresholds of 90/90/90/80 for the domain, data, preferences, URL, and stores layers, plus a ratchet for hooks and a global floor. Repository-level workflow and size checks live in `test/ci`. The Expo app uses jest-expo for both platform presets and Maestro for simulator flows.

Every pull request builds both apps and runs the full Maestro suite and the dark screenshot traversal on an Android emulator. The iOS build reuses the app cached for its native fingerprint. The iOS flows, split across three simulator shards, and the iOS dark traversal with its large-text captures run on every push to `main`, `feat/expo-native` and release branches, nightly, and on pull requests that change the iOS fingerprint. Run `scripts/fetch-ui-screenshots.sh <pr-number-or-run-id> <dir>` to download a run's screenshots. For pull requests that change `packages/native/src`, `packages/native/app`, `packages/core/src` or `.maestro`, the `pr-media` job compares each capture with the capture of the same name from the base commit's push run, using [pixelmatch](https://github.com/mapbox/pixelmatch) with the status bar and the Android scroll indicator masked. It uploads a `pr-media-<sha>` artifact holding one before and after image per changed screen, after-only images for new screens, and a `review.md` that lists removed screens and names any captures it could not compare and why. Large-text captures appear only when they change, next to their default-size pair. Before merging, run `scripts/attach-pr-media.sh <pr-number>`: it downloads that artifact for the head commit and prints the path of each image. Replace each `VERDICT_PENDING` in the printed `review.md` with what changed and whether it was intended, then run it again to post the file as a pull request review with the images uploaded. It refuses to post while a placeholder remains. CI cannot post the review itself because image uploads need a user token.

## Releasing

`.github/workflows/mobile-release.yml` builds the app with `eas build --local` on GitHub-hosted runners, using the `production` profile in `packages/native/eas.json`. It runs only when dispatched, and each build waits for the CI checks in `.github/required-checks.json` on the exact commit being shipped.

- **owner** uploads iOS to TestFlight with `eas submit`, where the internal testers get it, and Android to the Firebase App Distribution group `owner`, which the workflow creates if it is missing.
- **friends** does the same, then adds the iOS build to the app's one external TestFlight group, submitting it for beta review when Apple asks for one, and gives the Android release to the Firebase group `friends` as well.
- **promote_ios** and **promote_android** take a build number for that platform and give a build the owner already has to friends, without building again.

Every build listens on the `production` update channel, and the workflow checks the channel and runtime written into the finished APK and IPA before uploading. EAS numbers builds from one remote counter per platform, seeded above the last build numbered before EAS took over, so releases run one at a time. Before building, the workflow fails if the next number would not be above the highest build already on TestFlight or Firebase; `eas build:version:set` moves the counter. Both platforms sign with the Android keystore and Apple distribution certificate held in repository secrets, so every build installs over the last. To publish on the App Store, submit a TestFlight build for review in App Store Connect.

Local EAS builds ignore the `node` and `pnpm` versions in `eas.json`. The workflow installs Node from `.nvmrc` and pnpm from `packageManager`, while iOS builds use the fastlane, CocoaPods and Xcode tools preinstalled on the `macos-26` runner image, with Xcode selected explicitly.

## Shipping JavaScript updates

EAS Update can replace JavaScript and bundled assets. It cannot change native modules, permissions, app configuration, or other native code. The fingerprint runtime policy only offers an update to compatible installed builds, so any native change requires a new build. App version and build numbers stay out of the fingerprint, so a release's numbering never changes which updates it receives. The build profile in `packages/native/eas.json` sets a build's update channel, and the app config carries none, so builds of one commit share a runtime whichever channel they listen on.

Open GitHub Actions, choose **Publish update**, select **Run workflow**, and pick an action:

- **publish** exports the chosen ref with the EAS `production` environment and publishes it to the `preview` channel.
- **promote** copies one `preview` update group to `production` unchanged. Give it the group the owner tested; `eas update:list --branch preview --json` lists the groups with their messages and commits.

Only installs switched to preview receive `preview` updates. To switch one, long press the version number in Settings and turn on preview updates; Cue restarts on the preview channel and shows `preview` after the version. Switching back to production is safe for stored data: settings are plain keys that every version reads with defaults, and the cached Trakt data is dropped and fetched again whenever its shape version (the persisted cache buster) differs from the running bundle's. Nothing publishes on a push, pull request, merge, or schedule. A downloaded update applies on the next cold start.

To recover from a bad update, run `eas update:republish` to make a known good update current again, or `eas update:rollback` to select a previous or embedded update. Test rollback compatibility with any persisted state the bad update may have changed.

## Attribution

Powered by [Trakt](https://trakt.tv).

Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt. The app name is deliberately Trakt-free so Cue is never mistaken for an official Trakt product. The official Trakt logo is used in the Settings credit under Trakt's branding guidelines.

## Privacy

Cue runs no server and collects no analytics or telemetry. It talks to Trakt and the image hosts Trakt references. Your OAuth token, settings, queued marks, and cache stay on your device. See [PRIVACY.md](PRIVACY.md) for backup behavior and deletion instructions.

## License

Cue's source is licensed under [MIT](LICENSE). The Trakt name and logo are trademarks of Trakt and are not covered by that license.
