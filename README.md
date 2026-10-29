# Cue

Cue is a personal, zero-backend TV and movie tracker for iOS and Android. It syncs directly to your own [Trakt](https://trakt.tv) account and keeps the Up Next queue, library, calendar, history, and viewing stats focused on what you want to watch.

## Features

- Up Next with the next episode of every show you are watching, upcoming airings, and a drawer for shows you haven't watched lately.
- Optimistic mark-as-watched actions with batch undo and a durable offline write queue.
- Show and movie libraries with filtering, sorting, watchlist actions, and detail views.
- Calendar, search, history, profile statistics, and local episode reminders.
- Spoiler-aware episode artwork and per-play history removal.

## How it works

Cue has no backend of its own. The Expo app talks directly to Trakt over OAuth with a public client id and no client secret. Sync state lives in Trakt; tokens, preferences, queued writes, and cached data stay in the app's on-device storage.

## Development

Requires Node 22.23.4, the version in `.nvmrc`, and pnpm.

```sh
pnpm install
pnpm exec expo run:ios
pnpm exec expo run:android
pnpm check
```

Set `EXPO_PUBLIC_TRAKT_CLIENT_ID`, for example in a `.env` file, to the public client id of a Trakt API app. The app includes a local native module, so it does not run in Expo Go. `expo run:ios` and `expo run:android` generate the native project from `app.config.ts` and its config plugins, install a debug build on a simulator or emulator, and start Metro. `pnpm dev` starts Metro alone for a debug build that is already installed.

`pnpm check` is the deterministic repository gate. It runs Biome, oxlint, dprint, cspell, TypeScript, `expo install --check`, dependency-cruiser, knip, jscpd, the shipped-bundle checks, Vitest, and the iOS and Android jest-expo projects. pnpm refuses to install or run scripts under any Node other than the one in `engines.node`. In CI, the footprint job comments each pull request's line changes and bundle sizes without gating.

Git hooks are installed by `pnpm install`. Pre-commit runs the fast lint, formatting, spelling, and type gates. Pre-push runs `pnpm check`.

## Local fake Trakt

`test/core/trakt-fake` is the only Trakt fake. Core tests run it in process, and the Maestro smoke flows reach the same handlers over HTTP:

```sh
pnpm fake:trakt
```

Its README covers what it models, the rules for tests that use it, how `conformance.test.ts` holds it to recordings of real Trakt, and where each recording came from.

`test/core/harness/scenario-budget.test.tsx` replays user scenarios against the fake on generated accounts of a given size, and sizes each byte budget from the fake's own answers to the reads the scenario needs.

Set `EXPO_PUBLIC_TRAKT_API_BASE=http://127.0.0.1:8787` for a simulator build that should use the fake service. The Expo configuration adds a local transport exception only for that build. Store builds carry no exception. Set `EXPO_PUBLIC_CLOCK_START` to the instant of `FIXTURE_NOW` too: the app's clock then starts there at launch and runs on, so the app and the fake agree on which episodes have aired. CI sets it in `.github/workflows/ci.yml`; change both together. Store builds leave it unset, Metro leaves the clock out of their bundles, and `pnpm check:bundle` and the update workflow fail if it reaches one.

## Architecture

The repository is one Expo app:

- `app` contains the expo-router routes, `src` contains UI and platform adapters, `modules/cue-native` contains the local Expo module, and `plugins` contains config plugins.
- `src/core` owns the domain, Trakt data layer, durable write queue, hooks, stores, preferences, runtime, and platform ports. It has no dependency on Expo or React Native, compiles without DOM types under its own `tsconfig.json`, and is imported as `@/core/...`.

Dependencies flow from the app into the core. Dependency-cruiser enforces that boundary, keeps the domain and data layers narrow, and requires every Trakt read to use the shared pool.

## Testing

Core tests in `test/core` use Vitest, as do the tests for the repository scripts in `test/ci`. The app's tests in `__tests__` use jest-expo for both platform presets, and React Native Testing Library covers screen behavior.

End-to-end coverage is a short Maestro smoke suite in `.maestro/smoke`: sign in through the device code, mark the next episode from Up Next, visit every tab, open a show and a movie and mark an episode, search, and sign out. Every pull request push runs it on an Android emulator and an iOS simulator, against a release build of the app pointed at the fake. Each job fingerprints the native project with `@expo/fingerprint` and caches the native build under that hash; when the hash is already cached, `@expo/repack-app` swaps the commit's JavaScript into the cached build instead of compiling it again. If the iOS suite fails, the job warns and runs it once more from a fresh install and a reset fake. The jobs upload the screenshots each flow takes, plus Maestro's debug output when a flow fails. To check that the suite is deterministic, dispatch the CI workflow on a branch repeatedly with `gh workflow run ci.yml --ref <branch>`, once first so that run seeds the build cache.

To run the smoke flows locally, start `pnpm fake:trakt`, install a build made with the environment above on a simulator or emulator (`adb reverse tcp:8787 tcp:8787` on Android), and run `maestro test .maestro/smoke`.

## Releasing

`.github/workflows/mobile-release.yml` builds the app with `eas build --local` on GitHub-hosted runners, using the `production` profile in `eas.json`. It runs only when dispatched. A build first checks that every check in `.github/required-checks.json` ran on the exact commit and that every run of it passed, re-runs included.

- **owner** uploads iOS to TestFlight with `eas submit`, where the internal testers get it, and Android to the Firebase App Distribution group `owner`.
- **friends** does the same, then adds the iOS build to the app's one external TestFlight group, submitting it for beta review when Apple asks for one, and gives the Android release to the Firebase group `friends` as well.
- **promote_ios** and **promote_android** take a build number for that platform and give a build the owner already has to friends, without building again.

Every build listens on the `production` update channel, and the workflow checks the channel and runtime written into the finished APK and IPA before uploading. EAS numbers builds from one remote counter per platform, so releases run one at a time; `eas build:version:set` moves the counter. Both platforms sign with the Android keystore and Apple distribution certificate held in repository secrets, so every build installs over the last. To publish on the App Store, submit a TestFlight build for review in App Store Connect.

Local EAS builds take Node and pnpm from the runner, not `eas.json`. The workflow installs Node from `.nvmrc` and pnpm from `packageManager`, while iOS builds use the fastlane, CocoaPods and Xcode tools preinstalled on the `macos-26` runner image, with Xcode selected explicitly.

## Shipping JavaScript updates

EAS Update can replace JavaScript and bundled assets. It cannot change native modules, permissions, app configuration, or other native code. The fingerprint runtime policy only offers an update to compatible installed builds, so any native change requires a new build. App version and build numbers stay out of the fingerprint, so a release's numbering never changes which updates it receives. The build profile in `eas.json` sets a build's update channel, and the app config carries none, so builds of one commit share a runtime whichever channel they listen on.

Open GitHub Actions, choose **Publish update**, select **Run workflow** and pick an action. **publish** checks the commit's required checks as a build does:

- **publish** exports the chosen ref with the EAS `production` environment and publishes it to the `preview` channel.
- **promote** copies one `preview` update group to `production` unchanged. Give it the group the owner tested; `eas update:list --branch preview --json` lists the groups with their messages and commits.

Only installs switched to preview receive `preview` updates. To switch one, long press the version number in Settings and turn on preview updates; Cue restarts on the preview channel and shows `preview` after the version. Switching back to production is safe for stored data: settings are plain keys that every version reads with defaults, and the cached Trakt data is dropped and fetched again whenever the running build or update differs from the one that saved it. Nothing publishes on a push, pull request, merge, or schedule. A downloaded update applies on the next cold start.

To recover from a bad update, run `eas update:republish` to make a known good update current again, or `eas update:rollback` to select a previous or embedded update. Test rollback compatibility with any persisted state the bad update may have changed.

## Attribution

Powered by [Trakt](https://trakt.tv).

Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt. The app name is deliberately Trakt-free so Cue is never mistaken for an official Trakt product. The official Trakt logo is used in the Settings credit under Trakt's branding guidelines.

## Privacy

Cue runs no server and collects no analytics or telemetry. It talks to Trakt, the image hosts Trakt references, and Expo's update service, which it asks for JavaScript updates on launch. Your OAuth token, settings, queued marks, and cache stay on your device. See [PRIVACY.md](PRIVACY.md) for backup behavior and deletion instructions.

## License

Cue's source is licensed under [MIT](LICENSE). The Trakt name and logo are trademarks of Trakt and are not covered by that license.
