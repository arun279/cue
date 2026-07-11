# Cue Privacy

_Last reviewed: 2026-07._

Cue is a personal TV and movie tracker that talks directly to your own [Trakt](https://trakt.tv) account. This is the whole of what it does with your data.

## No server, nothing stored off your device

Cue runs no server of its own. There is no backend, no Cue account, and no database that Cue controls. Everything Cue keeps lives **only on the device you use it on**:

- your Trakt OAuth token (so you stay signed in), and
- a local cache of the shows, episodes, and history Cue reads from Trakt, plus your in-app settings.

All of your sync state (watch history, watchlist, ratings, progress) lives in **your own Trakt account**, which Cue reaches directly over HTTPS. Cue never proxies your data through any intermediary because there is no intermediary.

## No analytics, no telemetry

Cue collects no analytics and sends no telemetry. It makes no network requests except directly to Trakt (and to the image hosts Trakt points at) to do the tracking you asked for.

## Deleting your data

- **Cue's on-device data:** open **Settings → Disconnect Trakt**. Disconnecting revokes this device's access to your Trakt account, signs you out, and deletes the local cache and Trakt token stored on the device. Uninstalling the app removes the same data.
- **Your Trakt account itself:** Cue cannot delete it: Cue has no account of its own and no server-side copy of your data to delete. Only Trakt can delete a Trakt account. Do it at <https://app.trakt.tv/settings/advanced>.

## Hosting this document

To serve as the public "delete account URL" that Google Play and other stores require, this statement must be reachable at a stable public URL. This file (`PRIVACY.md`) is the single source of truth: it is served from the repository's own public URL, and can optionally be published via GitHub Pages. Point the store listing at that URL.

## Attribution

Powered by Trakt. Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt.
