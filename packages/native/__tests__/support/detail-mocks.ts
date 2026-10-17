jest.mock("@expo/ui/community/menu", () => require("./native-ui").menuModule());
jest.mock("expo-image", () => require("./detail").imageModule());
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
