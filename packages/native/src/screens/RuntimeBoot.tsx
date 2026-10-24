import { type RuntimeBootDeps, useRuntimeBoot } from "@cue/core/app/boot";
import { useAuth } from "@cue/core/auth/store";
import { RuntimeProvider } from "@cue/core/runtime/runtime";
import { type ReactElement, type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSplashRelease } from "../platform/splash";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { TEST_IDS } from "../ui/test-ids";
import { SPACE, useColors } from "../ui/tokens";

export interface RuntimeBootProps {
  readonly deps: Omit<RuntimeBootDeps, "endSession">;
  readonly children: ReactNode;
}

export function RuntimeBoot({ deps, children }: RuntimeBootProps): ReactElement | null {
  const endSession = useAuth((s) => s.endSession);
  const { runtime, failure, retry } = useRuntimeBoot({ ...deps, endSession });
  useSplashRelease(runtime !== null || failure !== null);

  if (runtime !== null) return <RuntimeProvider value={runtime}>{children}</RuntimeProvider>;
  if (failure !== null) return <BootFailure detail={failure} onRetry={retry} />;
  return null;
}

function BootFailure({
  detail,
  onRetry,
}: {
  readonly detail: string;
  readonly onRetry: () => void;
}): ReactElement {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (__DEV__) console.error(`Couldn't start Cue: ${detail}`);
  }, [detail]);
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
        <Button label="Retry" onPress={onRetry} />
      </EmptyState>
    </View>
  );
}

const styles = StyleSheet.create({ failure: { flex: 1 } });
