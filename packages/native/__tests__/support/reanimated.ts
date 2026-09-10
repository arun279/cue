/**
 * Reanimated's own test setup, which installs its animation clock over Jest's
 * timers. Without it every component that opens a shared value fails at import.
 */
require("react-native-reanimated").setUpTests();
