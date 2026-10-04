import { NativeTabs } from "expo-router/unstable-native-tabs";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { useColors } from "../../src/ui/tokens";

// One path per tab: NativeTabsNavigator does not forward initialRouteName, so groups sharing / land on the alphabetically first.
export default function TabsLayout(): ReactElement {
  const colors = useColors();
  return (
    <NativeTabs
      labelVisibilityMode="labeled"
      {...(Platform.OS === "ios"
        ? { tintColor: colors.accentInk }
        : {
            backgroundColor: colors.surface,
            iconColor: { default: colors.muted, selected: colors.accentInk },
            labelStyle: {
              default: { color: colors.muted },
              selected: { color: colors.accentInk },
            },
            indicatorColor: colors.elevated,
          })}
    >
      <NativeTabs.Trigger name="(up-next)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "play.square.stack", selected: "play.square.stack.fill" }}
          drawable="cue_tab_up_next"
        />
        <NativeTabs.Trigger.Label>Up Next</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
          drawable="cue_tab_library"
        />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(calendar)">
        <NativeTabs.Trigger.Icon sf="calendar" drawable="cue_tab_calendar" />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" drawable="cue_tab_search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
