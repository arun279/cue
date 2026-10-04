import type { CueRuntime } from "@cue/core/runtime/runtime";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { configure } from "reassure";
import { Harness, spyHaptics } from "./up-next";

configure({ testingLibrary: "react-native" });
jest.setTimeout(15_000);

/**
 * The providers a measurement runs under, with the caches it reads already
 * warm: a render measured against a pending query measures the skeleton.
 */
export function perfHarness(
  runtime: CueRuntime,
  seed: (client: QueryClient) => void,
): (props: { readonly children: ReactNode }) => ReactElement {
  const haptics = spyHaptics();
  return ({ children }) => (
    <Harness runtime={runtime} haptics={haptics} seed={seed}>
      {children}
    </Harness>
  );
}
