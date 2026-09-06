import { readsPausedUntil } from "@cue/core/data/trakt/read-budget";
import { type UpNextEmptyKind, upNextEmptyKind } from "@cue/core/domain/up-next";
import { stopWatching, useHideShow } from "@cue/core/hooks/useHideShow";
import { type MarkWatched, useMarkWatched } from "@cue/core/hooks/useMarkWatched";
import { useOnTheWay } from "@cue/core/hooks/useOnTheWay";
import { useStopSnacks } from "@cue/core/hooks/useStopSnacks";
import { useSyncBanner } from "@cue/core/hooks/useSyncBanner";
import { useSyncNow } from "@cue/core/hooks/useSyncNow";
import { type UpNextCard, type UpNextView, useUpNext } from "@cue/core/hooks/useUpNext";
import { useHaptics } from "@cue/core/ports/haptics";
import { usePrefs } from "@cue/core/prefs/prefs-store";
import { FlashList } from "@shopify/flash-list";
import { Stack, useRouter } from "expo-router";
import { type ReactElement, type ReactNode, useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chevron } from "../../ui/Chevron";
import { Row, Separator } from "../../ui/Row";
import { SyncStrip } from "../../ui/SyncStrip";
import { TEST_IDS } from "../../ui/test-ids";
import { ROW_MIN_HEIGHT, ROW_TEXT_INSET, SPACE, tabBarClearance, useColors } from "../../ui/tokens";
import { CueText } from "../../ui/type";
import { LapsedDrawer } from "./LapsedDrawer";
import { MarqueeCard } from "./MarqueeCard";
import { OnTheWay } from "./OnTheWay";
import { QueueRow } from "./QueueRow";
import {
  initialTutorialDismissed,
  persistTutorialDismissed,
  TutorialCaption,
} from "./TutorialCaption";
import { UpNextBarItems } from "./UpNextBarItems";
import { TvShowsOff, UpNextEmpty, UpNextError, UpNextSkeleton } from "./UpNextStates";

/** "On the way" is a summary, and the Calendar tab is the whole of it. */
const ON_THE_WAY_ROWS = 3;
/** The card renders only when the queue holds this many shows, and it consumes
 * the head of the queue rather than sitting on top of it. */
const MARQUEE_MIN_QUEUE = 3;

/**
 * Up Next is the home screen: what to watch next, and one tap to record it.
 *
 * Four sections in one scroll. The marquee promotes the head of the queue and is
 * the only thing on the screen that says an episode is new; the queue is the
 * list; the collapsed drawer holds what has gone idle; "On the way" answers what
 * is coming. The strip is the first thing in the scroll content and scrolls away
 * with it, because an ambient message that has already been read must not spend
 * 32 pt of every screen repeating itself.
 *
 * A mark leaves the queue and the list closes over it. That departure, plus the
 * snackbar's Undo, is what carries closure now that the old "Previously" strip
 * is gone; the History footer is where the whole log lives.
 */
export function UpNext(): ReactElement {
  const showsEnabled = usePrefs((state) => state.showsEnabled);
  const view = useUpNext(showsEnabled);
  const banner = useSyncBanner(view);
  const stop = useHideShow();
  const onTheWayDays = useOnTheWay(ON_THE_WAY_ROWS, showsEnabled);
  const mark = useTutorialGate(useMarkWatched());
  const refresh = usePullToRefresh();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  useStopSnacks(stop);

  const marquee = view.queue.length >= MARQUEE_MIN_QUEUE ? view.queue[0] : undefined;
  const rows = marquee === undefined ? view.queue : view.queue.slice(1);
  const onTheWay = onTheWayDays.length === 0 ? null : <OnTheWay days={onTheWayDays} />;
  const emptyKind = upNextEmptyKind({ ...view, queued: view.queue.length });

  return (
    <View testID={TEST_IDS.screenUpNext} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <Stack.Screen
        options={{
          title: "Up Next",
          headerLargeTitle: true,
          headerRight: () => <UpNextBarItems onSync={refresh.sync} />,
        }}
      />
      <FlashList
        testID={TEST_IDS.upNextList}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: tabBarClearance(insets.bottom) + SPACE.s4 }}
        data={rows}
        extraData={mark.tutorialVisible}
        keyExtractor={(card) => String(card.entry.showId)}
        ItemSeparatorComponent={() => <Separator inset={ROW_TEXT_INSET} />}
        refreshControl={
          <RefreshControl
            testID={TEST_IDS.refreshIndicator}
            refreshing={refresh.refreshing}
            onRefresh={refresh.pull}
            tintColor={colors.muted}
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View layout={LinearTransition}>
            <QueueRow
              card={item}
              mark={mark.controller}
              onStop={() => stopWatching(stop, item.entry)}
            />
            {index === 0 && mark.tutorialVisible ? <TutorialCaption /> : null}
          </Animated.View>
        )}
        ListHeaderComponent={
          <View style={styles.lead}>
            {banner === null ? null : <SyncStrip banner={banner} onRetry={view.refetch} />}
            <Lead
              view={view}
              showsEnabled={showsEnabled}
              emptyKind={emptyKind}
              marquee={marquee}
              mark={mark.controller}
              onTheWay={onTheWay}
            />
          </View>
        }
        ListFooterComponent={
          emptyKind === null && showsEnabled && !view.isLoading ? (
            <>
              <LapsedDrawer
                cards={view.lapsedCards}
                mark={mark.controller}
                onStop={(card) => stopWatching(stop, card.entry)}
              />
              {onTheWay}
              <HistoryFooter />
            </>
          ) : null
        }
      />
    </View>
  );
}

/**
 * What stands above the queue: the branch the screen is actually in. Exactly one
 * of these renders, and the populated case renders the card and lets the list
 * draw the rest.
 */
function Lead({
  view,
  showsEnabled,
  emptyKind,
  marquee,
  mark,
  onTheWay,
}: {
  readonly view: UpNextView;
  readonly showsEnabled: boolean;
  readonly emptyKind: UpNextEmptyKind | null;
  readonly marquee: UpNextCard | undefined;
  readonly mark: MarkWatched;
  readonly onTheWay: ReactNode;
}): ReactElement | null {
  if (!showsEnabled) return <TvShowsOff />;
  if (view.isLoading) return <UpNextSkeleton />;
  if (view.isError && !view.hasData) {
    return <UpNextError failure={view.failure} onRetry={view.refetch} />;
  }
  if (emptyKind !== null) {
    return <UpNextEmpty kind={emptyKind} watchlist={view.watchlistEntries} onTheWay={onTheWay} />;
  }
  return marquee === undefined ? null : <MarqueeCard card={marquee} mark={mark} />;
}

/**
 * Where "Previously" was: one row, at the target floor, opening the whole log.
 * It costs 44 pt once instead of ten rows plus their day headers, and it makes
 * History one tap from the home screen rather than two, which keeps the path
 * recognizable rather than recalled.
 */
function HistoryFooter(): ReactElement {
  const router = useRouter();
  const colors = useColors();

  return (
    <View style={styles.footer}>
      <Separator />
      <View style={styles.footerRow}>
        <Row
          label="History"
          minHeight={ROW_MIN_HEIGHT.footer}
          onPress={() => router.push("/history")}
          testID={TEST_IDS.linkHistory}
          trailing={<Chevron direction="forward" />}
        >
          <CueText variant="rowTitle" style={{ color: colors.fg }}>
            History
          </CueText>
        </Row>
      </View>
    </View>
  );
}

/**
 * The first-ever mark kills the tutorial line, whichever row fires it, so the
 * caption is a property of the mark controller rather than of any one row.
 */
function useTutorialGate(controller: MarkWatched): {
  readonly controller: MarkWatched;
  readonly tutorialVisible: boolean;
} {
  const [dismissed, setDismissed] = useState(initialTutorialDismissed);

  return {
    tutorialVisible: !dismissed,
    controller: {
      ...controller,
      mark: (entry) => {
        if (!dismissed) {
          persistTutorialDismissed();
          setDismissed(true);
        }
        return controller.mark(entry);
      },
    },
  };
}

/**
 * Pull to refresh, over the one manual sync pass the nav bar item and the
 * Settings row also run: two ways to ask for fresh data that do different things
 * is the divergence a design system exists to prevent.
 *
 * A pull released inside the client's 429 pause ends immediately on cached data
 * rather than spinning against a window the app already knows is closed, and
 * says so in the fingers with the warning tap. The strip states the reason.
 */
function usePullToRefresh(): {
  readonly refreshing: boolean;
  pull(): void;
  sync(): void;
} {
  const haptics = useHaptics();
  const syncNow = useSyncNow();
  const [pulling, setPulling] = useState(false);

  const pull = useCallback(() => {
    // Read live rather than from the last render: a 429 can open while the
    // screen sits, and what matters is the window at the moment of release.
    if (readsPausedUntil() > Date.now()) {
      haptics.warning();
      return;
    }
    setPulling(true);
    void syncNow.run().finally(() => setPulling(false));
  }, [haptics, syncNow]);

  return { refreshing: pulling, pull, sync: () => void syncNow.run() };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  lead: { paddingHorizontal: SPACE.s4, paddingBottom: SPACE.s2 },
  footer: { paddingTop: SPACE.s4 },
  footerRow: { paddingHorizontal: SPACE.s4, paddingVertical: SPACE.s1 },
});
