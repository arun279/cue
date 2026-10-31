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
  readonly inversePatch: unknown;
  readonly watchedAt: string | null;
  readonly fromState: "present" | "absent";
  readonly toState: "present" | "absent";
  readonly reconcileKeys: readonly string[];
}
