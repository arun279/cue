import { useState } from "react";
import { ActionSheetIOS, Alert, Platform } from "react-native";

export interface Confirmation {
  readonly title: string;
  readonly message: string;
  readonly primary: string;
  readonly secondary?: string;
  readonly onPrimary: () => void;
  readonly onSecondary?: () => void;
}

export function useConfirmation() {
  const [pending, setPending] = useState<Confirmation | null>(null);
  return {
    pending,
    dismiss: () => setPending(null),
    present: (confirmation: Confirmation): void => {
      const { title, message, primary, secondary, onPrimary, onSecondary } = confirmation;
      if (secondary === undefined) {
        Alert.alert(title, message, [
          { text: "Cancel", style: "cancel" },
          { text: primary, onPress: onPrimary },
        ]);
      } else if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          { title, message, options: [primary, secondary, "Cancel"], cancelButtonIndex: 2 },
          (index) => {
            if (index === 0) onPrimary();
            if (index === 1) onSecondary?.();
          },
        );
      } else {
        setPending(confirmation);
      }
    },
  };
}
