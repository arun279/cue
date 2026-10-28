/**
 * The three platform edges every tab-root screen test mounts over: the router,
 * the platform menu and the window insets. Imported for its side effects, before
 * the screen under test is required, so a file that needs all three says so in
 * one line rather than restating the same three factories.
 */
jest.mock("expo-router", () => require("./native-ui").expoRouterModule());
jest.mock("@expo/ui/community/menu", () => require("./native-ui").menuModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
