export class PendingWritesError extends Error {
  constructor() {
    super("Some changes haven't synced yet.");
    this.name = "PendingWritesError";
  }
}

export interface TeardownOptions {
  readonly force?: boolean;
}

export const sessionTeardown: { run: (options?: TeardownOptions) => Promise<void> } = {
  run: () => Promise.resolve(),
};
