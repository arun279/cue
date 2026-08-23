import { NativeTabs } from "expo-router/unstable-native-tabs";
import type { ReactElement } from "react";

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
 *
 * `role="search"` is what makes the last tab the platform's search destination:
 * the dedicated search tab on iOS 26 and later, the trailing item of the
 * Material navigation bar on Android. Two open issues touch it, so if it
 * misbehaves the fallback is a plain trigger and nothing else changes.
 */
export default function TabsLayout(): ReactElement {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(up-next)">
        <NativeTabs.Trigger.Icon sf="play.square.stack" md="play_circle" />
        <NativeTabs.Trigger.Label>Up Next</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)">
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" md="grid_view" />
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(calendar)">
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
        <NativeTabs.Trigger.Label>Calendar</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
