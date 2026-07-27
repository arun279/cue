# Cue Privacy

_Last reviewed: July 2026._

Cue is a personal TV and movie tracker that talks directly to your own [Trakt](https://trakt.tv) account. This is the whole of what it does with your data.

## No server, no account

Cue runs no server of its own. There is no backend, no Cue account, and no database that Cue controls, so there is no copy of anything on Cue's side to ask about. All of your sync state (watch history, watchlist, progress) lives in **your own Trakt account**, which Cue reaches directly over HTTPS. Cue never proxies your data through any intermediary because there is no intermediary.

## What Cue stores, and where

Everything Cue keeps is written to your device's own app storage:

- your Trakt OAuth token (so you stay signed in),
- anything you have marked that has not reached Trakt yet, and
- a local cache of the shows, episodes, and history Cue reads from Trakt, plus your in-app settings.

Cue itself never copies any of that off the device, beyond the syncing with Trakt you asked for. Your phone's own backup service is a separate matter: it copies app storage into your personal cloud account, and that is your operating system doing the copying, not Cue. The two platforms give apps different amounts of say in it, so Cue's answer differs:

- **Android:** Cue opts out. Nothing Cue stores is included in a Google backup or carried over by Android's own device-to-device transfer, so a restored or replaced phone starts signed out. Signing back in is one short code at <https://trakt.tv/activate>. Versions of Cue before this one did not opt out, so Google may still hold a backup taken while an older version was installed. Deleting that device's backup from your Google account removes it, and signing out asks Trakt to revoke the token inside it either way.
- **iOS:** Cue does not yet opt out. iOS keeps app preferences, your Trakt token among them, in a store that is included in a device backup by default, and Cue has not moved the token off that store yet, so your token can sit inside an iCloud backup or a backup you have taken to a computer. For iCloud, open **Settings → [your name] → iCloud → Manage Account Storage → Backups**, pick your device, and switch Cue off: iOS stops backing Cue up and removes what iCloud already holds. That switch does not reach a backup stored on a computer, so delete that one yourself. Signing out asks Trakt to revoke the token in any copy.

## No analytics, no telemetry

Cue collects no analytics and sends no telemetry. It makes no network requests except directly to Trakt (and to the image hosts Trakt points at) to do the tracking you asked for.

## Deleting your data

- **Cue's on-device data:** open **Settings → Sign out**. Signing out asks Trakt to revoke this device's access to your Trakt account, and deletes Cue's local settings, cache, and Trakt token stored on the device. The delete is what Cue can guarantee: the revoke is a request to Trakt, so if it does not go through, revoke Cue from your Trakt account settings as well. Uninstalling the app removes the same local data. Neither reaches a copy already sitting in a device backup, which is what the backup section above is for.
- **Your Trakt account itself:** Cue cannot delete it: Cue has no account of its own and no server-side copy of your data to delete. Only Trakt can delete a Trakt account. Do it at <https://app.trakt.tv/settings/advanced>.

## Hosting this document

The canonical served copy of this policy is [`docs/index.html`](docs/index.html), published by GitHub Pages at <https://arun279.github.io/cue/>. Point store privacy and account-deletion links at that stable URL; this Markdown file is the repository-readable companion.

## Attribution

Powered by Trakt. Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt.
