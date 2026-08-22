import { ScreenHeader } from "@ui/app-shell/ScreenHeader";
import { ActionSheet } from "@ui/components/ActionSheet";
import { dismissSnack, showSnack } from "@ui/components/snackbar-store";
import { useDocumentTitle } from "@ui/hooks/useDocumentTitle";
import { usePrefs } from "@ui/prefs/prefs-store";
import { THRESHOLD_OPTIONS } from "@ui/prefs/threshold";
import {
  LAPSED_ORDER_OPTIONS,
  type LapsedOrder,
  NEXT_EPISODE_ORDER_OPTIONS,
  type NextEpisodeOrder,
} from "@ui/prefs/tracking";
import { useAppVersion } from "@ui/runtime/app-version";
import { useReminders } from "@ui/runtime/reminders";
import { ThemeToggle } from "@ui/theme/ThemeToggle";
import { Check, RefreshCw } from "lucide-react";
import { type ReactElement, useState } from "react";
import {
  SettingLinkRow,
  SettingRow,
  SettingSection,
  SettingSelectRow,
  SettingSwitch,
} from "./SettingRow";
import { SignOutRow } from "./SignOutRow";
import { useSyncStatus } from "./useSyncStatus";

/** Trakt account management lives on Trakt: Cue only hands the user off to it. */
const TRAKT_SETTINGS_URL = "https://app.trakt.tv/settings";
/** Trakt account deletion lives on Trakt: Cue only hands the user off to it. */
const TRAKT_ACCOUNT_SETTINGS_URL = "https://app.trakt.tv/settings/advanced";

// The official Trakt logo ships UNALTERED as a required attribution asset.
// `import.meta.glob` resolves it eagerly and it renders in the "Powered by
// Trakt" credit below; the `?? null` fallback keeps the build green if the
// asset is ever absent.
const traktLogoModules = import.meta.glob<{ readonly default: string }>(
  "../../assets/trakt-logo.svg",
  { eager: true },
);
const traktLogoSrc = Object.values(traktLogoModules)[0]?.default ?? null;

/** "2 weeks" / "3 weeks": every threshold option is a whole number of weeks. */
function weeksLabel(days: number): string {
  const weeks = days / 7;
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

const ORDER_LABELS: Record<NextEpisodeOrder, string> = {
  "oldest-unwatched": "Oldest unwatched",
  "after-last-watched": "After last watched",
};
const LAPSED_ORDER_LABELS: Record<LapsedOrder, string> = {
  "recently-watched": "Recently watched first",
  "longest-idle": "Longest idle first",
};

/** The picked-option tell for radio sheets; the blank keeps labels aligned. */
function radioIcon(selected: boolean): ReactElement {
  return selected ? <Check aria-hidden="true" /> : <span className="setting-radio-gap" />;
}

function ChoiceSetting<T extends string | number>({
  label,
  hint,
  testId,
  title,
  value,
  options,
  labelOf,
  optionTestId,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly testId: string;
  readonly title: string;
  readonly value: T;
  readonly options: readonly T[];
  labelOf(option: T): string;
  optionTestId(option: T): string;
  onChange(option: T): void;
}): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingSelectRow
        label={label}
        hint={hint}
        value={labelOf(value)}
        testId={testId}
        onPress={() => setOpen(true)}
      />
      <ActionSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        rows={options.map((option) => ({
          label: labelOf(option),
          icon: radioIcon(option === value),
          testId: optionTestId(option),
          onPress: () => onChange(option),
        }))}
      />
    </>
  );
}

/**
 * Settings: grouped rows over the device-local preference stores plus the two
 * account hand-offs. Appearance (theme + haptics), Notifications (the daily
 * airing digest, and the one place its OS permission is ever asked for),
 * Tracking (spoiler stills,
 * queue order, drawer order, the staleness threshold that feeds Up Next's lapsed drawer),
 * Content (media visibility with the last-one-on guard), Data (the one place
 * full sync state lives), Account (Trakt hand-offs + sign out), About (version
 * + the required Trakt attribution).
 */
export function Settings(): ReactElement {
  useDocumentTitle("Settings · Cue");
  const appVersion = useAppVersion();
  const thresholdDays = usePrefs((s) => s.thresholdDays);
  const setThresholdDays = usePrefs((s) => s.setThresholdDays);
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  const setShowsEnabled = usePrefs((s) => s.setShowsEnabled);
  const setMoviesEnabled = usePrefs((s) => s.setMoviesEnabled);
  const hapticsEnabled = usePrefs((s) => s.hapticsEnabled);
  const setHapticsEnabled = usePrefs((s) => s.setHapticsEnabled);
  const remindersEnabled = usePrefs((s) => s.remindersEnabled);
  const setRemindersEnabled = usePrefs((s) => s.setRemindersEnabled);
  const hideStills = usePrefs((s) => s.hideStillsUntilWatched);
  const setHideStills = usePrefs((s) => s.setHideStillsUntilWatched);
  const order = usePrefs((s) => s.nextEpisodeOrder);
  const setOrder = usePrefs((s) => s.setNextEpisodeOrder);
  const lapsedOrder = usePrefs((s) => s.lapsedOrder);
  const setLapsedOrder = usePrefs((s) => s.setLapsedOrder);

  const sync = useSyncStatus();
  const reminders = useReminders();

  // The OS prompt fires here and nowhere else: this row is the in-context ask
  // both platforms call for, and its own line is the pre-prompt that explains
  // what arrives. A refusal leaves the switch off rather than promising
  // notifications the OS will never deliver.
  const onRemindersChange = (checked: boolean): void => {
    if (!checked) {
      setRemindersEnabled(false);
      return;
    }
    void reminders.requestPermission().then((granted) => {
      setRemindersEnabled(granted);
      if (granted) return;
      showSnack({
        message: "Notifications are off for Cue. Turn them on in your phone's settings.",
        actions: [{ label: "Dismiss", onPress: dismissSnack }],
      });
    });
  };

  // The one enabled medium can't be turned off: the app is never emptied of both.
  const media = [
    { key: "shows", label: "TV shows", enabled: showsEnabled, setEnabled: setShowsEnabled },
    { key: "movies", label: "Movies", enabled: moviesEnabled, setEnabled: setMoviesEnabled },
  ] as const;
  const enabledCount = (showsEnabled ? 1 : 0) + (moviesEnabled ? 1 : 0);

  return (
    <section className="screen-settings" data-testid="screen-settings">
      <ScreenHeader title="Settings" variant="child" fallback="/profile" />

      <SettingSection label="Appearance">
        <SettingRow label="Theme" control={<ThemeToggle />} />
        <SettingRow
          label="Haptics"
          hint="Short taps as a mark lands, a swipe or pull crosses its threshold, or you move between tabs. Applies on the phone app."
          control={
            <SettingSwitch
              checked={hapticsEnabled}
              onChange={setHapticsEnabled}
              label="Haptics"
              testId="haptics-toggle"
            />
          }
        />
      </SettingSection>

      <SettingSection label="Notifications">
        <SettingRow
          label="Episode reminders"
          hint="One notification each morning naming what airs that day. Nothing leaves your device: it is scheduled on the phone from the calendar Cue already has. Applies on the phone app."
          control={
            <SettingSwitch
              checked={remindersEnabled}
              onChange={onRemindersChange}
              label="Episode reminders"
              testId="reminders-toggle"
            />
          }
        />
      </SettingSection>

      <SettingSection label="Tracking">
        <SettingRow
          label="Hide episode stills until watched"
          hint="Keeps unwatched episode images spoiler-safe until you reveal them."
          control={
            <SettingSwitch
              checked={hideStills}
              onChange={setHideStills}
              label="Hide episode stills until watched"
              testId="stills-toggle"
            />
          }
        />
        <ChoiceSetting
          label="Next episode order"
          testId="order-select"
          title="Next episode order"
          value={order}
          options={NEXT_EPISODE_ORDER_OPTIONS}
          labelOf={(option) => ORDER_LABELS[option]}
          optionTestId={(option) => `order-${option}`}
          onChange={setOrder}
        />
        <ChoiceSetting
          label="Haven't watched lately order"
          testId="lapsed-order-select"
          title="Haven't watched lately order"
          value={lapsedOrder}
          options={LAPSED_ORDER_OPTIONS}
          labelOf={(option) => LAPSED_ORDER_LABELS[option]}
          optionTestId={(option) => `lapsed-order-${option}`}
          onChange={setLapsedOrder}
        />
        <ChoiceSetting
          label="Haven't watched in a while after"
          hint="A show drops into the drawer at the bottom of Up Next once this long has passed since both your last watch and its next episode aired."
          testId="threshold-select"
          title="Haven't watched in a while after"
          value={thresholdDays}
          options={THRESHOLD_OPTIONS}
          labelOf={weeksLabel}
          optionTestId={(days) => `threshold-${days}`}
          onChange={setThresholdDays}
        />
      </SettingSection>

      <SettingSection label="Content" testId="content-section">
        {media.map((item) => (
          <SettingRow
            key={item.key}
            label={item.label}
            control={
              <SettingSwitch
                checked={item.enabled}
                disabled={item.enabled && enabledCount === 1}
                onChange={(checked) => item.setEnabled(checked)}
                label={item.label}
                testId={`content-toggle-${item.key}`}
              />
            }
          />
        ))}
        <p className="setting-note" data-testid="content-hint">
          Track TV shows, movies, or both. Turn off a medium and Cue hides it everywhere: Library,
          Search, and your history. At least one stays on.
        </p>
      </SettingSection>

      <SettingSection label="Data">
        <p
          className="setting-status"
          data-ok={sync.pending === 0 || undefined}
          data-testid="sync-status"
        >
          {sync.line}
        </p>
        <button
          type="button"
          className="setting-row setting-row--press"
          data-testid="sync-now"
          disabled={sync.syncing}
          onClick={() => void sync.syncNow()}
        >
          <span className="setting-row__label">{sync.syncing ? "Syncing…" : "Sync now"}</span>
          <RefreshCw className="setting-row__external" aria-hidden="true" />
        </button>
      </SettingSection>

      <SettingSection label="Account">
        <SettingLinkRow
          label="Manage Trakt account"
          href={TRAKT_SETTINGS_URL}
          testId="link-manage-account"
        />
        <SignOutRow />
        <p className="setting-note">
          Only Trakt can delete your Trakt account. This opens Trakt in your browser to do it. Cue
          has no account of its own to delete.
        </p>
        <SettingLinkRow
          label="Delete your Trakt account"
          href={TRAKT_ACCOUNT_SETTINGS_URL}
          testId="link-delete-account"
        />
      </SettingSection>

      <SettingSection label="About">
        <SettingRow
          label="Version"
          control={
            <span className="setting-row__value" data-testid="settings-version">
              {appVersion}
            </span>
          }
        />
        <a
          className="setting-attribution"
          href="https://trakt.tv"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="powered-by-trakt"
        >
          {traktLogoSrc !== null && (
            <img className="setting-attribution__logo" src={traktLogoSrc} alt="Trakt" />
          )}
          Powered by Trakt
        </a>
        <p className="setting-note" data-testid="trakt-attribution">
          Cue uses the Trakt API but is not created, endorsed, or sponsored by Trakt.
        </p>
      </SettingSection>
    </section>
  );
}
