/**
 * React Native's jest preset stands the View host up without the commands
 * `android_ripple` sends on press, so a ripple target would throw when tapped.
 */
jest.mock("react-native/Libraries/Components/View/ViewNativeComponent", () => ({
  __esModule: true,
  default: jest.requireActual("@react-native/jest-preset/jest/mocks/ViewNativeComponent").default,
  Commands: { hotspotUpdate: () => {}, setPressed: () => {} },
}));
