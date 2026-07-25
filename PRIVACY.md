# Cue Privacy

_Last reviewed: July 2026._

Cue is a personal TV and movie tracker that talks directly to your own [Trakt](https://trakt.tv) account. This is the whole of what it does with your data.

## No server, nothing stored off your device

Cue runs no server of its own. There is no backend, no Cue account, and no database that Cue controls. Everything Cue keeps lives **only on the device you use it on**:

- your Trakt OAuth token (so you stay signed in), and
- a local cache of the shows, episodes, and history Cue reads from Trakt, plus your in-app settings.

All of your sync state (watch history, watchlist, progress) lives in **your own Trakt account**, which Cue reaches directly over HTTPS. Cue never proxies your data through any intermediary because there is no intermediary.

## No analytics, no telemetry

Cue collects no analytics and sends no telemetry. It makes no network requests except directly to Trakt (and to the image hosts Trakt points at) to do the tracking you asked for.

## Deleting your data

- **Cue's on-device data:** open **Settings → Sign out**. Signing out revokes this device's access to your Trakt account and deletes Cue's local settings, cache, and Trakt token stored on the device. Uninstalling the app removes the same data.
- **Your Trakt account itself:** Cue cannot delete it: Cue has no account of its own and no server-side copy of your data to delete. Only Trakt can delete a Trakt account. Do it at <https://app.trakt.tv/settings/advanced>.

## Hosting this document

The canonical served copy of this policy is [`docs/index.html`](docs/index.html), published by GitHub Pages at <https://arun279.github.io/cue/>. Point store privacy and account-deletion links at that stable URL; this Markdown file is the repository-readable companion.

## Attribution

Powered by Trakt. Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt.
