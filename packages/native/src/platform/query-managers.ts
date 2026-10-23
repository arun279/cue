import { focusManager, onlineManager } from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { AppState } from "react-native";

const isOnline = (state: NetworkState): boolean => state.isConnected !== false;

export function connectQueryManagers(): void {
  onlineManager.setEventListener((setOnline) => {
    void getNetworkStateAsync().then(
      (state) => setOnline(isOnline(state)),
      () => {},
    );
    const subscription = addNetworkStateListener((state) => setOnline(isOnline(state)));
    return () => subscription.remove();
  });
  focusManager.setEventListener((setFocused) => {
    // iOS reports inactive during a call banner, the app switcher or a system prompt.
    const subscription = AppState.addEventListener("change", (status) =>
      setFocused(status === "active"),
    );
    return () => subscription.remove();
  });
}
