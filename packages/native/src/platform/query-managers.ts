import { focusManager, onlineManager } from "@tanstack/react-query";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { AppState } from "react-native";

const isOnline = (state: NetworkState): boolean =>
  state.isConnected !== false && state.isInternetReachable !== false;

export function connectQueryManagers(): void {
  onlineManager.setEventListener((setOnline) => {
    let heard = false;
    const subscription = addNetworkStateListener((state) => {
      heard = true;
      setOnline(isOnline(state));
    });
    void getNetworkStateAsync().then(
      (state) => {
        if (!heard) setOnline(isOnline(state));
      },
      () => {},
    );
    return () => subscription.remove();
  });
  focusManager.setEventListener((setFocused) => {
    // iOS reports inactive during a call banner, the app switcher or a system prompt.
    setFocused(AppState.currentState !== "background");
    const subscription = AppState.addEventListener("change", (status) =>
      setFocused(status === "active"),
    );
    return () => subscription.remove();
  });
}
