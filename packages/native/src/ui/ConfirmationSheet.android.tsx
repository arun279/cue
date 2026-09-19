import { Host, ModalBottomSheet, RNHostView } from "@expo/ui/jetpack-compose";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { ConfirmationSheetProps } from "./ConfirmationSheet";
import { TEST_IDS } from "./test-ids";
import { SPACE, useColors } from "./tokens";
import { CueText } from "./type";

export function ConfirmationSheet({
  confirmation,
  onDismiss,
}: ConfirmationSheetProps): ReactElement | null {
  const colors = useColors();
  if (confirmation === null) return null;
  const actions = [
    {
      label: confirmation.primary,
      run: confirmation.onPrimary,
      testID: TEST_IDS.confirmSheetPrimary,
    },
    { label: confirmation.secondary, run: confirmation.onSecondary },
    { label: "Cancel", run: onDismiss },
  ];
  return (
    <Host>
      <ModalBottomSheet onDismissRequest={onDismiss} skipPartiallyExpanded>
        <RNHostView matchContents>
          <View testID={TEST_IDS.confirmSheet} style={styles.content}>
            <CueText variant="sectionHeading" style={{ color: colors.fg }}>
              {confirmation.title}
            </CueText>
            <CueText variant="rowTitleSecondary" style={{ color: colors.ink2 }}>
              {confirmation.message}
            </CueText>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                testID={action.testID}
                accessibilityRole="button"
                style={styles.action}
                onPress={() => {
                  onDismiss();
                  action.run?.();
                }}
              >
                <CueText variant="rowTitle" style={{ color: colors.fg }}>
                  {action.label}
                </CueText>
              </Pressable>
            ))}
          </View>
        </RNHostView>
      </ModalBottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACE.s5, gap: SPACE.s2 },
  action: { minHeight: 56, justifyContent: "center" },
});
