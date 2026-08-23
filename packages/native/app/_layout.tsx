import { Stack } from "expo-router";
import type { ReactElement } from "react";

/** The root navigator. The composition root mounts here once it exists. */
export default function RootLayout(): ReactElement {
  return <Stack />;
}
