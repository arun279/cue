// Metro does not need this file; the jest lane does. Without it `babel-jest`
// finds no config, does not strip the Flow types out of `@react-native/jest-preset`'s
// own setup file, and every suite dies before a test runs.
module.exports = { presets: ["babel-preset-expo"] };
