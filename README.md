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

Every pull request builds both apps and runs the full Maestro suite and the dark screenshot traversal on an Android emulator. The iOS build reuses the app cached for its native fingerprint. The iOS flows, split across three simulator shards, the iOS dark traversal and the contact sheets for both platforms run on every push to `main`, `feat/expo-native` and release branches, nightly, and on pull requests that change the iOS fingerprint. Run `scripts/fetch-ui-screenshots.sh <pr-number-or-run-id> <dir>` to download a run's screenshots and contact sheets. For pull requests that change `packages/native/src`, `packages/native/app`, `packages/core/src` or `.maestro`, the `pr-media` job gathers the four contact sheets and the large-text captures into one `pr-media-<sha>` artifact with a `captions.tsv` naming the screen, state, platform and appearance of each image. When a push skips the iOS lane, the artifact holds the newest captures from the base branch and says so. Before merging, run `scripts/attach-pr-media.sh <pr-number>`: it downloads that artifact for the head commit, replaces the pull request's media comment with the images attached through `gh pr comment --attach`, and prints the local path of each image to open. CI cannot post the comment itself because `gh` uploads attachments only with a user token.

## Releasing

`.github/workflows/mobile-release.yml` builds and ships the app. A `v*` tag submits to the App Store, and a manual dispatch can run either the tester or store lane. Each release waits for the required CI checks on the exact commit being shipped.

## Installing on your own devices

The `preview` profile in `packages/native/eas.json` builds with EAS internal distribution: an ad hoc signed IPA for registered iPhones and an APK for Android, both on the `preview` update channel. EAS CLI evaluates the app config and its plugins and computes the runtime fingerprint from the local `node_modules`, so install the workspace on Node 22.12.0 first and sign in. Run the EAS commands from `packages/native`.

```sh
pnpm install
npx eas-cli@latest login
```

Once, store the Trakt client id in the EAS `preview` environment and register each iPhone:

```sh
npx eas-cli@latest env:set --name EXPO_PUBLIC_TRAKT_CLIENT_ID --value <client id> --environment preview --visibility plaintext
npx eas-cli@latest device:create
```

Then build:

```sh
npx eas-cli@latest build --platform ios --profile preview
npx eas-cli@latest build --platform android --profile preview
```

The first build on each platform asks to set up EAS managed signing: an Apple sign in for the ad hoc provisioning profile, and a new Android keystore. When the first iOS build asks `Generate a new Apple Distribution Certificate?`, answer no and give it the `.p12` file and password behind the release workflow's `BUILD_CERTIFICATE_BASE64`, or add that certificate beforehand with `npx eas-cli@latest credentials --platform ios`. Never revoke a certificate when EAS offers to: the release workflow signs with it. An iPhone registered later needs a new build. Open the install link from the finished build on the phone. On iOS, turn on Developer Mode under Settings > Privacy & Security when asked. The APK is signed with a different key than the Firebase tester build, so uninstall that first.

These builds keep build number 1 and never reach App Store Connect or Firebase, so they never use a number the release workflow needs. Updates published to the `preview` channel reach them. A build stops before compiling when the environment has no client id.

## Shipping JavaScript updates

EAS Update can replace JavaScript and bundled assets. It cannot change native modules, permissions, app configuration, or other native code. The fingerprint runtime policy only offers an update to installed builds with the same runtime, so any native change requires a new build. The release workflow puts each build's own build number into its runtime, so today updates reach only the EAS `preview` builds, not tester or store builds.

To publish, open GitHub Actions, choose **Publish update**, select **Run workflow**, choose the exact ref and the `preview` or `production` channel, write a required message, and run it. Nothing publishes on a push, pull request, merge, or schedule. A downloaded update applies on the next cold start.

To recover from a bad update, run `eas update:republish` to make a known good update current again, or `eas update:rollback` to select a previous or embedded update. Test rollback compatibility with any persisted state the bad update may have changed.

## Attribution

Powered by [Trakt](https://trakt.tv).

Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt. The app name is deliberately Trakt-free so Cue is never mistaken for an official Trakt product. The official Trakt logo is used in the Settings credit under Trakt's branding guidelines.

## Privacy

Cue runs no server and collects no analytics or telemetry. It talks to Trakt and the image hosts Trakt references. Your OAuth token, settings, queued marks, and cache stay on your device. See [PRIVACY.md](PRIVACY.md) for backup behavior and deletion instructions.

## License

Cue's source is licensed under [MIT](LICENSE). The Trakt name and logo are trademarks of Trakt and are not covered by that license.
