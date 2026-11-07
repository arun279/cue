export class PendingWritesError extends Error {
  constructor() {
    super("Some changes haven't synced yet.");
    this.name = "PendingWritesError";
  }
}
