// Stand-ins for the native modules most screens reach. A suite that needs the real
// module, or another stand-in, says so with its own jest.unmock or jest.mock.
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("@expo/ui/community/menu", () => require("./native-ui").menuModule());
jest.mock("@expo/ui/jetpack-compose", () => require("./native-ui").composeModule());
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () =>
  require("./native-ui").swipeableModule(),
);
jest.mock("expo-sqlite/kv-store", () => require("./native-stores").kvStoreModule);
