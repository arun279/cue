import { NativeTabs } from "expo-router/unstable-native-tabs";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { useColors } from "../../src/ui/tokens";

/**
 * Four tabs, fixed, never pruned, on four distinct paths.
 *
 * **Fixed**, because media visibility is a reversible preference two screens
 * away in Settings, and a navigation structure that changes item count when a
 * switch flips is the least predictable thing a shell can do. Apple's tab-bar
 * guidance names the case directly ("Don't disable or hide tab bar buttons, even
 * when their content is unavailable ... If a section is empty, explain why") and
 * Material's navigation bar says destinations do not change. So a movies-only
 * user keeps four tabs, and the two with nothing in them say why.
 *
 * **Distinct paths**, because `NativeTabsNavigator` calls `useNavigationBuilder`
 * without forwarding `initialRouteName`: with four groups all serving `/` the
 * alphabetically first group becomes the landing screen and nothing changes it.
 * A path per tab works around that and is better anyway, because every tab is
 * then deep-linkable.
 */
export default function TabsLayout(): ReactElement {
  const colors = useColors();
  return (
    <NativeTabs
      labelVisibilityMode="labeled"
      // iOS draws the bar in Liquid Glass, which a custom fill would cover.
      backgroundColor={Platform.OS === "android" ? colors.surface : undefined}
      iconColor={{ default: colors.muted, selected: colors.accentInk }}
      labelStyle={{ default: { color: colors.muted }, selected: { color: colors.accentInk } }}
      indicatorColor={colors.elevated}
    >
      <NativeTabs.Trigger name="(up-next)">
        <NativeTabs.Trigger.Icon sf="play.square.stack" drawable="cue_tab_up_next" />
        <NativeTabs.Trigger.Label>Up Next</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)">
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" drawable="cue_tab_library" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(calendar)">
        <NativeTabs.Trigger.Icon sf="calendar" drawable="cue_tab_calendar" />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" drawable="cue_tab_search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
