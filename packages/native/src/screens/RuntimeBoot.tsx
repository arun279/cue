import { type RuntimeBootDeps, useRuntimeBoot } from "@cue/core/app/boot";
import { useAuth } from "@cue/core/auth/store";
import { RuntimeProvider } from "@cue/core/runtime/runtime";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSplashRelease } from "../platform/splash";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Marker } from "../ui/Marker";
import { TEST_IDS } from "../ui/test-ids";
import { SPACE, useColors } from "../ui/tokens";

export interface RuntimeBootProps {
  /** Everything the runtime needs except the token, which boot reads for itself,
   * and the dead-token exit, which belongs to the auth store and is read here. */
  readonly deps: Omit<RuntimeBootDeps, "endSession">;
  readonly children: ReactNode;
}

export function RuntimeBoot({ deps, children }: RuntimeBootProps): ReactElement {
  // A dead refresh token routes through the auth store's teardown to onboarding.
  const endSession = useAuth((s) => s.endSession);
  const { runtime, failed, retry } = useRuntimeBoot({ ...deps, endSession });
  useSplashRelease(runtime !== null || failed);

  if (runtime !== null) return <RuntimeProvider value={runtime}>{children}</RuntimeProvider>;
  if (failed) return <BootFailure onRetry={retry} />;
  return <Marker testID={TEST_IDS.runtimeLoading} />;
}

function BootFailure({ onRetry }: { readonly onRetry: () => void }): ReactElement {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={TEST_IDS.runtimeError}
      style={[
        styles.failure,
        {
          backgroundColor: colors.bg,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left + SPACE.s4,
          paddingRight: insets.right + SPACE.s4,
        },
      ]}
    >
      <EmptyState
        headline="Couldn't start Cue"
        body="Cue couldn't open what it keeps on this device."
      >
        <Button label="Retry" testID={TEST_IDS.runtimeErrorRetry} onPress={onRetry} />
      </EmptyState>
    </View>
  );
}

const styles = StyleSheet.create({ failure: { flex: 1 } });
