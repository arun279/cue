import { act } from "@testing-library/react-native";
import { router, Tabs } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { Profiler, type ReactElement, useSyncExternalStore } from "react";
import { Text } from "react-native";
import { TabStack } from "../src/TabStack";
import { QueryProvider } from "./support/query-provider";

let count = 0;
const listeners = new Set<() => void>();
const bump = () => {
  count += 1;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const commits: number[] = [];

function Root(): ReactElement {
  const value = useSyncExternalStore(subscribe, () => count);
  return (
    <Profiler id="root" onRender={() => commits.push(value)}>
      <Text>{value}</Text>
    </Profiler>
  );
}

it("holds a tab's root still while two screens cover it, and catches it up on return", async () => {
  jest.useFakeTimers();
  await renderRouter(
    {
      "(tabs)/_layout": () => <Tabs />,
      "(tabs)/(up-next)/_layout": () => <TabStack root="index" title="Up Next" />,
      "(tabs)/(up-next)/index": Root,
      "(tabs)/(up-next)/show/[showId]": () => <Text>Show</Text>,
    },
    { initialUrl: "/", wrapper: QueryProvider },
  );
  await act(async () => router.push("/show/1"));
  await act(async () => router.push("/show/2"));
  await act(async () => jest.runOnlyPendingTimers());
  commits.length = 0;

  await act(async () => bump());
  expect(commits).toEqual([]);

  await act(async () => router.back());
  await act(async () => jest.runOnlyPendingTimers());
  expect(commits.at(-1)).toBe(count);
  jest.useRealTimers();
});
