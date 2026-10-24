import { ActionSheetIOS, Alert, Platform } from "react-native";

export interface Confirmation {
  readonly title: string;
  readonly message: string;
  readonly primary: string;
  readonly secondary?: string;
  readonly secondaryDestructive?: boolean;
  readonly onPrimary: () => void;
  readonly onSecondary?: () => void;
}

export function confirm({
  title,
  message,
  primary,
  secondary,
  secondaryDestructive,
  onPrimary,
  onSecondary,
}: Confirmation): void {
  const cancel = { text: "Cancel", style: "cancel" } as const;
  const accept = { text: primary, onPress: onPrimary };
  if (secondary === undefined) {
    Alert.alert(title, message, [cancel, accept]);
  } else if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [primary, secondary, "Cancel"],
        cancelButtonIndex: 2,
        ...(secondaryDestructive === true ? { destructiveButtonIndex: 1 } : {}),
      },
      (index) => {
        if (index === 0) onPrimary();
        if (index === 1) onSecondary?.();
      },
    );
  } else {
    const style = secondaryDestructive === true ? "destructive" : undefined;
    Alert.alert(title, message, [{ text: secondary, onPress: onSecondary, style }, cancel, accept]);
  }
}
