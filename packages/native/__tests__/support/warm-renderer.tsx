import { render } from "@testing-library/react-native";
import Animated from "react-native-reanimated";

// The first update of a Reanimated component asks React Native for its view
// tag, which loads the renderer's public instance and DOM node modules. Doing
// that here keeps the load, over a second on a cold transform cache, out of
// each file's first case.
beforeAll(async () => {
  const warm = await render(<Animated.View />);
  await warm.rerender(<Animated.View />);
  warm.unmount();
});
