// React Native's runtime provides the idle callback globals; the Jest environment does not.
globalThis.requestIdleCallback ??= (callback) =>
  Number(setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1));
globalThis.cancelIdleCallback ??= (handle) => clearTimeout(handle);
