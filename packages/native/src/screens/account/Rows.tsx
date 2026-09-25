import type { ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chevron } from "../../ui/Chevron";
import { Row, Separator } from "../../ui/Row";
import { RowMenu } from "../../ui/RowMenu";
import { ROW_MIN_HEIGHT, SPACE, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";

export function AccountScreen({
  testID,
  children,
}: {
  readonly testID: string;
  readonly children: ReactNode;
}): ReactElement {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: SPACE.s4,
        paddingBottom: insets.bottom + SPACE.s5,
        gap: SPACE.s5,
      }}
    >
      {children}
    </ScrollView>
  );
}

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactElement {
  const colors = useColors();
  return (
    <View>
      <CueText
        variant="meta"
        eyebrow
        accessibilityRole="header"
        style={{ color: colors.muted, marginBottom: SPACE.s2 }}
      >
        {title}
      </CueText>
      {children}
    </View>
  );
}

export function Note({ children }: { readonly children: ReactNode }): ReactElement {
  const colors = useColors();
  return (
    <CueText variant="caption" style={{ color: colors.muted, paddingVertical: SPACE.s2 }}>
      {children}
    </CueText>
  );
}

interface SettingRowProps {
  readonly title: string;
  readonly hint?: string;
  readonly trailing?: ReactNode;
  readonly testID?: string;
  readonly onPress?: () => void;
}

export function SettingRow({
  title,
  hint,
  trailing,
  testID,
  onPress,
}: SettingRowProps): ReactElement {
  const colors = useColors();
  return (
    <>
      <Row
        label={hint ? `${title}. ${hint}` : title}
        minHeight={ROW_MIN_HEIGHT.settings}
        trailing={trailing}
        testID={testID}
        onPress={onPress}
      >
        <CueText variant="rowTitle" weight="regular" style={{ color: colors.fg }}>
          {title}
        </CueText>
        {hint ? (
          <CueText variant="meta" style={{ color: colors.muted }}>
            {hint}
          </CueText>
        ) : null}
      </Row>
      <Separator />
    </>
  );
}

export function Toggle({
  value,
  onChange,
  disabled = false,
  ...row
}: Omit<SettingRowProps, "trailing" | "onPress"> & {
  readonly value: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
}): ReactElement {
  return (
    <SettingRow
      {...row}
      testID={undefined}
      trailing={
        <Switch
          accessible
          testID={row.testID}
          accessibilityRole="switch"
          accessibilityLabel={row.title}
          accessibilityHint={row.hint}
          accessibilityState={{ disabled, checked: value }}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
        />
      }
    />
  );
}

export function Picker<T extends string | number>({
  title,
  hint,
  value,
  options,
  onChange,
  testID,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly testID: string;
}): ReactElement {
  const colors = useColors();
  const label = options.find((option) => option.value === value)?.label;
  return (
    <SettingRow
      title={title}
      hint={hint}
      trailing={
        <RowMenu
          title={title}
          testID={testID}
          openOnLongPress={false}
          items={options.map((option) => ({
            id: String(option.value),
            label: option.label,
            selected: option.value === value,
            onPress: () => onChange(option.value),
          }))}
        >
          <View
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${title}, ${label}`}
            style={styles.picker}
          >
            <CueText
              variant="rowTitle"
              weight="regular"
              style={{ color: colors.muted, flexShrink: 1 }}
            >
              {label}
            </CueText>
            <Chevron direction="down" />
          </View>
        </RowMenu>
      }
    />
  );
}

const styles = StyleSheet.create({
  picker: {
    minHeight: ROW_MIN_HEIGHT.settings,
    flexDirection: "row",
    alignItems: "center",
    maxWidth: 210,
  },
});
