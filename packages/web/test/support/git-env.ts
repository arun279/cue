/**
 * The environment a child `git` may run in from a test.
 *
 * Git exports `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY` and friends
 * into every hook it runs, and a child process inherits them. `pnpm check` is
 * the pre-push hook, so a test that shells out to git inside a temp repository
 * would reach the real one instead: `git init` in a scratch directory followed
 * by `git commit` rewrote the branch being pushed and left every tracked file
 * looking deleted. Stripping the prefix covers the whole family at once.
 */
export function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
}
