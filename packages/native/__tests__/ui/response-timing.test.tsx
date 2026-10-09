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

it("exposes the latest fifteen mark and undo samples", async () => {
  const taps = Array.from({ length: 16 }, (_, tap) => tap);
  const durations = taps.flatMap((tap) => [tap + 0.5, tap + 100]);
  Object.defineProperty(performance, "measure", {
    configurable: true,
    value: jest.fn(() => ({ duration: durations.shift() }) as PerformanceMeasure),
  });
  await render(<Probe />);

  await act(async () => {
    for (const _ of taps) {
      beginResponseTiming("mark");
      commitResponseTiming();
      beginResponseTiming("undo");
      commitResponseTiming();
    }
  });

  const kept = taps.slice(1);
  expect(screen.getByTestId("timing")).toHaveTextContent(
    `Response timing: mark ${kept.map((tap) => `${tap}.5`).join(",")}; undo ${kept.map((tap) => `${tap + 100}.0`).join(",")}`,
  );
});
