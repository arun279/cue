/// <reference types="vite/client" />

/**
 * The build-time variables Cue reads, declared so `src/app/config.ts` can name
 * each one with a property access. Vite replaces a named access with that
 * variable's literal value; an index access makes it inline the WHOLE env
 * object, which would put every variable present at build time into the bundle,
 * including ones the app deliberately ignores.
 */
interface ImportMetaEnv {
  /** Cue's public Trakt client id. The app refuses to start without it. */
  readonly VITE_TRAKT_CLIENT_ID?: string;
  /** The local fake Trakt's origin, honoured only under `--mode mock`. */
  readonly VITE_TRAKT_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
