import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let enabled = false;
const listeners = new Set<() => void>();

function update(value: boolean): void {
  enabled = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  let active = true;
  const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", update);
  void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
    if (active) update(value);
  });
  return () => {
    active = false;
    subscription.remove();
    listeners.delete(listener);
  };
}

export function useScreenReader(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}
