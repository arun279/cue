import { useAppVersion } from "@cue/core/ports/app-version";
import { useReminders } from "@cue/core/ports/reminders";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { THRESHOLD_OPTIONS } from "@cue/core/prefs/threshold";
import { showSnack } from "@cue/core/stores/snackbar-store";
import { openBrowserAsync } from "expo-web-browser";
import type { ReactElement } from "react";
import { Image, Pressable, View } from "react-native";
import { TEST_IDS } from "../ui/test-ids";
import { SPACE, TARGET_MIN, useColors } from "../ui/tokens";
import { CueText } from "../ui/type";
import { DataSection } from "./account/DataSection";
import { AccountScreen, Note, Picker, Section, SettingRow, Toggle } from "./account/Rows";
import { SignOut } from "./account/SignOut";
import { ThemeControl } from "./account/ThemeControl";

const NEXT = [
  { value: "oldest-unwatched", label: "Oldest unwatched" },
  { value: "after-last-watched", label: "After last watched" },
] as const;
const LAPSED = [
  { value: "recently-watched", label: "Recently watched first" },
  { value: "longest-idle", label: "Longest idle first" },
] as const;
const THRESHOLDS = THRESHOLD_OPTIONS.map((value) => ({ value, label: `${value / 7} weeks` }));

async function openTrakt(url: string): Promise<void> {
  try {
    await openBrowserAsync(url);
  } catch {
    showSnack({ message: "Couldn't open Trakt. Please try again." });
  }
}

function ExternalLink({
  title,
  url,
  testID,
  mark = false,
}: {
  readonly title: string;
  readonly url: string;
  readonly testID: string;
  readonly mark?: boolean;
}): ReactElement {
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityHint="Opens Trakt in your browser"
      onPress={() => void openTrakt(url)}
      style={{ minHeight: TARGET_MIN, flexDirection: "row", alignItems: "center", gap: SPACE.s2 }}
    >
      {mark ? (
        <Image source={require("./account/trakt.png")} style={{ width: 22, height: 22 }} />
      ) : null}
      <CueText variant="rowTitle" weight="regular" style={{ flex: 1, color: colors.fg }}>
        {title}
      </CueText>
      <CueText variant="rowTitle" style={{ color: colors.muted }}>
        ↗
      </CueText>
    </Pressable>
  );
}

export default function Settings(): ReactElement {
  const prefs = usePrefs((state) => state);
  const colors = useColors();
  const version = useAppVersion();
  const reminders = useReminders();
  const setReminders = async (enabled: boolean): Promise<void> => {
    if (enabled && !(await reminders.requestPermission())) {
      showSnack({
        message: "Notifications are off for Cue. Turn them on in your phone's settings.",
      });
      return;
    }
    prefs.setRemindersEnabled(enabled);
  };
  return (
    <AccountScreen testID={TEST_IDS.screenSettings}>
      <Section title="Appearance">
        <SettingRow title="Theme" trailing={<ThemeControl />} />
        <Toggle
          title="Haptics"
          hint="A short buzz when you mark something watched or take it back."
          testID={TEST_IDS.settingsHaptics}
          value={prefs.hapticsEnabled}
          onChange={prefs.setHapticsEnabled}
        />
      </Section>
      <Section title="Tracking">
        <Toggle
          title="Hide episode stills until watched"
          hint="Keeps unwatched episode images spoiler-safe until you reveal them."
          testID={TEST_IDS.settingsSpoilers}
          value={prefs.hideStillsUntilWatched}
          onChange={prefs.setHideStillsUntilWatched}
        />
        <Picker
          title="Next episode order"
          value={prefs.nextEpisodeOrder}
          options={NEXT}
          onChange={prefs.setNextEpisodeOrder}
          testID={TEST_IDS.settingsNextOrder}
        />
        <Picker
          title="Haven't watched lately order"
          value={prefs.lapsedOrder}
          options={LAPSED}
          onChange={prefs.setLapsedOrder}
          testID={TEST_IDS.settingsLapsedOrder}
        />
        <Picker
          title="Haven't watched in a while after"
          hint="A show drops into the drawer at the bottom of Up Next once this long has passed since both your last watch and its next episode aired."
          value={prefs.thresholdDays}
          options={THRESHOLDS}
          onChange={prefs.setThresholdDays}
          testID={TEST_IDS.settingsThreshold}
        />
      </Section>
      <Section title="Reminders">
        <Toggle
          title="Episode reminders"
          hint="One notification each morning naming what airs that day, scheduled on the phone itself. Reminders are planned four weeks ahead each time you open Cue."
          testID={TEST_IDS.settingsReminders}
          value={prefs.remindersEnabled}
          onChange={(enabled) => void setReminders(enabled)}
        />
      </Section>
      <Section title="Content">
        <Toggle
          title="TV shows"
          testID={TEST_IDS.settingsShows}
          value={prefs.showsEnabled}
          onChange={prefs.setShowsEnabled}
          disabled={!prefs.moviesEnabled}
        />
        <Toggle
          title="Movies"
          testID={TEST_IDS.settingsMovies}
          value={prefs.moviesEnabled}
          onChange={prefs.setMoviesEnabled}
          disabled={!prefs.showsEnabled}
        />
        <Note>
          Track TV shows, movies, or both. Turn off a medium and Cue hides it everywhere: Library,
          Search, and your history. At least one stays on.
        </Note>
      </Section>
      <DataSection />
      <Section title="Account">
        <ExternalLink
          title="Manage Trakt account"
          url="https://app.trakt.tv/settings"
          testID={TEST_IDS.settingsTrakt}
        />
        <SignOut />
        <Note>
          Only Trakt can delete your Trakt account. This opens Trakt in your browser to do it. Cue
          has no account of its own to delete.
        </Note>
        <ExternalLink
          title="Delete your Trakt account"
          url="https://app.trakt.tv/settings/advanced"
          testID={TEST_IDS.settingsDelete}
        />
      </Section>
      <Section title="About">
        <SettingRow
          title="Version"
          trailing={
            <CueText
              testID={TEST_IDS.settingsVersion}
              variant="rowTitle"
              weight="regular"
              style={{ color: colors.muted }}
            >
              {version}
            </CueText>
          }
        />
        <ExternalLink
          title="Powered by Trakt"
          url="https://trakt.tv"
          testID={TEST_IDS.settingsPoweredBy}
          mark
        />
        <View testID={TEST_IDS.settingsAttribution}>
          <Note>Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt.</Note>
        </View>
      </Section>
    </AccountScreen>
  );
}
