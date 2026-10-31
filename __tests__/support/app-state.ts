import { AppState } from "react-native";

// React Native's jest mock leaves currentState as a mock function, and every launch the suite models is in the foreground.
Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
