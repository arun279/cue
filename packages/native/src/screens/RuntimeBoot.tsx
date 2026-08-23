import { type RuntimeBootDeps, useRuntimeBoot } from "@cue/core/app/boot";
import { useAuth } from "@cue/core/auth/store";
import { RuntimeProvider } from "@cue/core/runtime/runtime";
import type { ReactElement, ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export interface RuntimeBootProps {
  /** Everything the runtime needs except the token, which boot reads for itself,
   * and the dead-token exit, which belongs to the auth store and is read here. */
  readonly deps: Omit<RuntimeBootDeps, "endSession">;
  readonly children: ReactNode;
}

/**
 * The native app's three boot surfaces over the shared boot effect: loading, a
 * retryable failure, and the runtime handed to the tree through context.
 *
 * The effect itself, which reads the token, restores and replays the durable
 * write queue and registers the teardown, is `@cue/core/app/boot` and is the
 * same on both targets; only these three renders differ. What must not be lost
 * in that split is the behavior behind it: a failed startup reconcile has to
 * reach a visible retry rather than a stuck spinner.
 *
 * The dependencies arrive assembled, from the composition root that already
 * knows which build this is and where the cache lives, so this file knows only
 * how to draw three states.
 */
export function RuntimeBoot({ deps, children }: RuntimeBootProps): ReactElement {
  // A dead refresh token routes through the auth store's teardown to onboarding.
  const endSession = useAuth((s) => s.endSession);
  const { runtime, failed, retry } = useRuntimeBoot({ ...deps, endSession });

  if (failed && runtime === null) {
    return (
      <SafeAreaView testID="runtime-error">
        <Text accessibilityRole="alert">Couldn't start Cue.</Text>
        <Pressable accessibilityRole="button" testID="runtime-error-retry" onPress={retry}>
          <Text>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (runtime === null) {
    return (
      <SafeAreaView testID="runtime-loading">
        <Text>Loading your queue…</Text>
      </SafeAreaView>
    );
  }

  return <RuntimeProvider value={runtime}>{children}</RuntimeProvider>;
}
