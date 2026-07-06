# Cue

Cue is a web-first PWA (with a Capacitor mobile shell) for your **Up Next** queue — the next episode to watch, backed by Trakt.

- Zero backend. A browser SPA that talks directly to Trakt (sync/state) and TMDB (art/metadata), plus a thin Capacitor WebView wrapper for iOS/Android.
- This repo is a do-nothing app shell with a fully green deterministic check harness. Real routes and features land in later milestones.

## Stack

- React 19 + TypeScript (strict) SPA on Vite 8 (Rolldown), built with pnpm on Node 22.
- Tailwind CSS v4 (`@theme` tokens) for styling; layered source under `src/domain`, `src/data`, `src/ui`, `src/app`, `src/platform`.
- Capacitor 8 thin shell — all `@capacitor/*` imports are confined to `src/platform` (enforced by dependency-cruiser).

## Scripts

- `pnpm dev` — start the Vite dev server.
- `pnpm build` — build the static SPA into `dist/`.
- `pnpm preview` — preview the production build.
- `pnpm check` — the full deterministic gate: Biome (lint + format), dprint (markdown), cspell, `tsc --noEmit`, dependency-cruiser, knip, jscpd, a production `vite build`, and Vitest with coverage.
- `pnpm audit` — high/critical prod advisories. Kept out of `pnpm check` (live advisory state is non-deterministic); enforced as its own CI job on every push/PR plus a weekly schedule.
- `pnpm e2e` — the Playwright end-to-end suite (chromium). First run: `pnpm exec playwright install chromium`.
- `pnpm sync` — `cap sync` (mobile shell; requires a platform added via `cap add`).

Git hooks are wired via lefthook (`pnpm prepare` runs `lefthook install`): pre-commit runs the fast gates (Biome, dprint, cspell, typecheck); pre-push runs the full `pnpm check` and `pnpm e2e`. CI (`.github/workflows/ci.yml`) runs `pnpm check`, `pnpm audit`, and `pnpm e2e` on Node 22.

## Credentials

Cue needs no committed secrets. It is a public OAuth client and authenticates with PKCE, so only a Trakt **client_id** (create a free app at <https://trakt.tv/oauth/applications>, registering `<origin>/auth/callback` as the redirect URI) and an optional TMDB API key are entered **at runtime** and stored on-device (non-evictable via Capacitor Preferences on mobile). No client secret is used. They are never written to the repo or baked into the build.

## Deferred checks

Advanced gates that only make sense once features exist (axe-core a11y, Lighthouse-CI budgets, bundle-size budgets, SW/offline smoke, Trakt contract fixtures, Capacitor build smoke) are tracked as `TODO(checks-<milestone>)` items in [docs/CHECKS.md](docs/CHECKS.md) and wired as real gates in their milestones — not stubbed as no-ops now.
