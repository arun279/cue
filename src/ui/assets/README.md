# UI assets

## `trakt-logo.svg` — required attribution asset (not committed)

Settings → About shows a "Powered by Trakt" credit. Trakt's API terms require the **unaltered official Trakt logo** to appear there. That asset is not redistributed in this repo; drop it in as `trakt-logo.svg` in this folder:

1. Download the logo from <https://app.trakt.tv/branding>.
2. Use the **dark** asset (the About panel sits on a dark surface).
3. Keep it **unaltered** and preserve its required clear-space.
4. Save it here as `trakt-logo.svg` — no code change is needed. `Settings.tsx` picks it up automatically (`import.meta.glob`) and renders it; until then the text credit stands on its own, which already satisfies the terms.
