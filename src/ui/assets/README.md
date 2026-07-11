# UI assets

## `trakt-logo.svg`: required attribution asset

Settings → About shows a "Powered by Trakt" credit. Trakt's API terms require the **unaltered official Trakt logo** to appear there. That asset is present in this folder as `trakt-logo.svg` and `Settings.tsx` picks it up automatically via `import.meta.glob`.

The committed file is the official **gradient logomark** from <https://trakt.tv/branding>, downloaded unaltered. The gradient mark is used (rather than a white-on-dark wordmark) because the About surface follows the app's light/dark theme, and the gradient tile stays legible on both. Keep it **unaltered** and preserve its required clear-space if you ever replace it.
