# Trakt fake

The only stand-in for Trakt in this repository. It holds a seeded account, OAuth sessions, Trakt's rate limits and every route the app calls, as MSW handlers.

- `account.ts`: the default account, `sized(...)` for generated accounts, and `emptyAccount()` for a test that adds its own shows. Seeded dates count from `FIXTURE_NOW`.
- `bodies.ts` and `writes.ts`: the read bodies and the write endpoints.
- `fake.ts`: sessions, the rate limiter, the routes, the request log and the one-shot fault helpers (`fail`, `hold`, `drop`).
- `in-process.ts`: `startTraktFake()`, which serves the handlers to a test file through `setupServer`.
- `serve.ts`: the same handlers over HTTP on 127.0.0.1:8787 for the smoke flows (`pnpm fake:trakt`), with `POST /__approve` and `POST /__reset`.

## Rules for tests

- Reach Trakt through this fake. Only files in this directory may import `msw`, and oxlint enforces it.
- Get failures from the fault helpers, not from a stub `fetch`.
- The one exception is `test/data/trakt-tolerant-decoding.test.ts`. Its bodies are off-spec on purpose (missing fields, bodies that are not JSON, pages without their headers), which the fake never sends, so it stubs `fetch`.

## How the fake is checked

`conformance.test.ts` compares the fake with `recordings.json`. It asks the fake every read the app makes and fails on any path, type, string class, status or header Trakt was never seen sending, and on any 404 from a recorded read. It also runs `scenarios.ts` on a clock spaced like the recorder's request guard, and fails on any difference from a recorded transcript.

What cannot be recorded follows Trakt's documentation and is tested in `fake.test.ts`: token lifetime and the device token statuses (https://docs.trakt.tv/reference/postoauthdevicetoken), and the rate limits (https://developer.trakt.tv/docs/rate-limiting).

## Provenance of recordings.json

Every recording came from a throwaway Trakt account. The requests went through a paced, guarded recorder: one request at a time, GETs at least 1.1 s apart and writes at least 1.5 s apart, stopping on any 429. The 2026-10-24 recorder also stopped on any unexpected 401, 403 or 5xx. Before each phase that wrote, the recorder checked it was signed in to that account. Tokens, codes, the client id and account names were scrubbed. Catalogue ids were kept and history play ids renumbered.

| Group                                                                                                                    | Recorded   | How                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shapes` (every read the app makes)                                                                                      | 2026-10-21 | The app's own reads, captured through the guarded recorder and reduced to structure with no values                                                                                                                                                                                                  |
| `transcripts.multiple-plays-off`: `markAndUndo`, `rewatch`, `tiedMarks`, `unknownItems`, `paging`, `hidden`, `dropped`   | 2026-10-21 | An earlier version of `scenarios.ts`, run through the guarded recorder with Multiple Plays off                                                                                                                                                                                                      |
| `transcripts.multiple-plays-on`: `rewatch`                                                                               | 2026-10-21 | The same, with Multiple Plays switched on for the run and off afterwards                                                                                                                                                                                                                            |
| `transcripts.multiple-plays-off`: `oauth`, `errors`, `pageLimits`, `watchlist`, `seasonMark`, `specials`, `movieRewatch` | 2026-10-24 | A separate recorder captured whole requests and responses. The transcripts were reduced from those by hand, and the matching scenarios were written afterwards to repeat the same steps                                                                                                             |
| `transcripts.multiple-plays-on`: `movieRewatch`                                                                          | 2026-10-24 | The same, with Multiple Plays switched on for the run and off afterwards                                                                                                                                                                                                                            |
| `transcripts.multiple-plays-on`: `severalPlays`; `transcripts.multiple-plays-off`: `specialOnlyPlay`                     | 2026-10-24 | A later session of the same recorder: a show's watched row and progress after a first, a now-dated and a year-backdated play of one episode, removing the newest play by history id, a play of an unaired special, and an aired special as the show's only play. Reduced by hand like the row above |

None of the scenarios in `scenarios.ts` has been run against real Trakt as it stands. A transcript records what Trakt answered, not what this code would send. Recording again means running the scenarios through such a guarded recorder on a throwaway account, never a real one.

## Unrecorded behavior

These are guesses until a recording settles them.

- Whether an aired special played after a regular episode moves the show's `last_watched_at`. The fake says it does; the recordings show only that an unaired special's play does not, and that an aired special sets it when it is the show's only play.
- Progress with `specials=false` when the show's only play is a special.
