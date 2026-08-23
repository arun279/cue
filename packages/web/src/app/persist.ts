const REQUESTED_FLAG = "cue.persist-requested";

/**
 * Ask the browser to make storage durable so the persisted
 * Query cache and (web) token store survive eviction under storage pressure:
 * the eviction the write-queue durability promise depends on not happening.
 * Requested once, at first run.
 */
export async function requestPersistentStorage(): Promise<void> {
  if (localStorage.getItem(REQUESTED_FLAG) !== null) return;
  localStorage.setItem(REQUESTED_FLAG, "1");
  await navigator.storage?.persist?.();
}
