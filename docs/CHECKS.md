# Check harness — status and deferred gates

The gate is fully wired and green. Every check below that is listed as **active** is locally runnable AND enforced by both a lefthook hook and CI — no `continue-on-error`, no informational-only gates, no skips.

## Active gates

Run together as `pnpm check` (+ `pnpm e2e`):

| Gate               | Command                 | Enforces                                                           |
| ------------------ | ----------------------- | ------------------------------------------------------------------ |
| Biome              | `biome check .`         | Lint (React domain) + format for JS/TS/JSX/JSON                    |
| dprint             | `dprint check`          | Markdown formatting                                                |
| cspell             | `cspell ...`            | Spelling across ts/tsx/css/md                                      |
| TypeScript         | `tsc --noEmit`          | Strict type-check                                                  |
| dependency-cruiser | `depcruise src`         | Layering + `@capacitor/*` only in `src/platform`                   |
| knip               | `knip`                  | No unused files / deps / exports                                   |
| jscpd              | `jscpd`                 | Duplicate-code detection (threshold 0)                             |
| Vite build         | `vite build`            | Production build (Vite/Tailwind/PWA wiring) compiles               |
| Vitest             | `vitest run --coverage` | Unit tests; 90% lines on `src/domain` + `src/data`                 |
| Playwright         | `playwright test`       | E2E smoke (chromium): shell mounts, title `Cue`, no console errors |

`pnpm audit --prod --audit-level=high` is deliberately **outside** `pnpm check`: it reads live advisory state, so the same commit could flip red without a code change. It runs as its own CI job (on every push/PR plus a weekly schedule) and via `pnpm audit`, keeping the local `pnpm check` gate deterministic.

## Deferred gates (wire as REAL gates in the noted milestone)

These are intentionally NOT added as no-op gates now — they need real features/surfaces to assert against. Grep target: `TODO(checks-`.

- TODO(checks-a11y): `@axe-core/playwright` accessibility assertions on every screen's rendered states (WCAG 2.0 AA). Needs real screens — wire when the first feature screens exist.
- TODO(checks-contrast): deterministic contrast-token unit test over the Tailwind `@theme` tokens. Wire once the token set is finalized.
- TODO(checks-lighthouse): Lighthouse-CI with concrete budget assertions (not the flaky aggregate score) — cold-start/perf budgets. Needs a representative built app.
- TODO(checks-bundle): bundle-size budgets on the built `dist/` chunks. Wire once the real dependency set (router, query, radix, zod) is in.
- TODO(checks-pwa): service-worker / offline / precache smoke suite (the dedicated PWA Playwright project). Needs the full vite-plugin-pwa runtime behavior enabled.
- TODO(checks-trakt-contract): Trakt/TMDB contract tests against recorded fixtures (MSW + Zod boundary), incl. a browser-level check that pagination + `Retry-After` headers are readable. Needs the typed client.
- TODO(checks-capacitor): Capacitor build smoke (`pnpm build && cap sync`, Android + web on Linux CI; iOS codegen documented, compile needs macOS+Xcode). Wire when a mobile release path is set up.
