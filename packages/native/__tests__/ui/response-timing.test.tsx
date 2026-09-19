import { act, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Text } from "react-native";
import {
  beginResponseTiming,
  commitResponseTiming,
  resetResponseTiming,
  useResponseTiming,
} from "../../src/ui/response-timing";

const methods = ["mark", "measure", "clearMarks", "clearMeasures"] as const;
const originalDescriptors = new Map(
  methods.map((method) => [method, Object.getOwnPropertyDescriptor(performance, method)]),
);

function Probe(): ReactElement {
  return <Text testID="timing">{useResponseTiming()}</Text>;
}

beforeEach(() => {
  resetResponseTiming();
  Object.defineProperties(performance, {
    mark: { configurable: true, value: jest.fn() },
    clearMarks: { configurable: true, value: jest.fn() },
    clearMeasures: { configurable: true, value: jest.fn() },
  });
});

afterEach(() => {
  for (const method of methods) {
    const descriptor = originalDescriptors.get(method);
    if (descriptor === undefined) Reflect.deleteProperty(performance, method);
    else Object.defineProperty(performance, method, descriptor);
  }
});

it("exposes five-sample mark and undo medians", async () => {
  const durations = [9, 20, 5, 14, 7, 18, 6, 16, 8, 12];
  Object.defineProperty(performance, "measure", {
    configurable: true,
    value: jest.fn(() => ({ duration: durations.shift() }) as PerformanceMeasure),
  });
  await render(<Probe />);

  await act(async () => {
    for (let sample = 0; sample < 5; sample += 1) {
      beginResponseTiming("mark");
      commitResponseTiming("mark");
      beginResponseTiming("undo");
      commitResponseTiming("undo");
    }
  });

  expect(screen.getByTestId("timing")).toHaveTextContent(
    "Response timing: mark 7.0 ms, undo 16.0 ms",
  );
});
