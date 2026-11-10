export interface RequestDescriptor {
  readonly method: "POST";
  readonly path: string;
  readonly body: unknown;
}

export interface DispatchResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: unknown;
}

export interface QueuedOp {
  readonly id: string;
  readonly itemKey: string;
  readonly request: RequestDescriptor;
  readonly inverse: RequestDescriptor;
  readonly watchedAt: string | null;
  readonly fromState: "present" | "absent";
  readonly toState: "present" | "absent";
  /**
   * The id of the history add this write takes back. Only the plays that add made are removed: they
   * are found once, when this write is first due, and the write then removes exactly those.
   */
  readonly undoes?: string;
  /** The show or movie whose screens show this write, as `show:<id>` or `movie:<id>`. */
  readonly target?: string;
  /** When Trakt first asked this write to wait. */
  readonly refusedSince?: number;
  /** Trakt refused it, and what it showed on screen has not been read back from Trakt yet. */
  readonly refused?: true;
}
