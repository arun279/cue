import { Badge } from "@ui/components/Badge";
import { ConfirmSheet } from "@ui/components/ConfirmSheet";
import type { MarkWatched } from "@ui/hooks/useMarkWatched";
import type { UpNextCard } from "@ui/hooks/useUpNext";
import { ChevronDown, EllipsisVertical } from "lucide-react";
import { Accordion } from "radix-ui";
import { type ReactElement, useState } from "react";
import { QueueRow } from "./QueueRow";

interface LapsedDrawerProps {
  readonly cards: readonly UpNextCard[];
  readonly mark: MarkWatched;
  /** Stop watching a lapsed show: the parent owns the hide + its snackbar. */
  onStop(card: UpNextCard): void;
}

/** The non-gesture Stop path: a 44px overflow opening the shared ConfirmSheet, so
 * swipe-left is an accelerator, never the only way (WCAG 2.5.1). */
function StopSheet({ title, onStop }: { readonly title: string; onStop(): void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="row-overflow"
        data-testid="lapsed-overflow"
        aria-label={`More actions for ${title}`}
        onClick={() => setOpen(true)}
      >
        <EllipsisVertical aria-hidden="true" />
      </button>
      <ConfirmSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        body="Stopping keeps your watch history."
        primary={{ label: "Stop show", testId: "lapsed-stop", onPress: onStop }}
      />
    </>
  );
}

/**
 * "Haven't watched lately": the collapsed disclosure at the bottom of the queue
 * for in-progress-but-idle shows (ordered per the Haven't watched lately order preference). A pruning prompt, never a
 * wall of shame: mark to catch up in place (the show re-sorts into the queue) or
 * stop it (swipe-left / overflow, snackbar-reversible). A decided show leaves on
 * its own, so there is no per-session dismissal to lose on reload.
 */
export function LapsedDrawer({ cards, mark, onStop }: LapsedDrawerProps): ReactElement | null {
  if (cards.length === 0) return null;

  return (
    <Accordion.Root type="single" collapsible className="lapsed" data-testid="lapsed-drawer">
      <Accordion.Item value="lapsed">
        <Accordion.Header className="lapsed__header">
          <Accordion.Trigger className="lapsed__trigger" data-testid="lapsed-heading">
            Haven't watched lately
            <Badge testId="lapsed-count">{cards.length}</Badge>
            <ChevronDown className="lapsed__chevron" aria-hidden="true" />
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content className="lapsed__content">
          <ul className="row-list">
            {cards.map((card) => (
              <li key={card.entry.showId}>
                <QueueRow
                  card={card}
                  mark={mark}
                  variant="lapsed"
                  onStop={() => onStop(card)}
                  trailingExtra={<StopSheet title={card.entry.title} onStop={() => onStop(card)} />}
                />
              </li>
            ))}
          </ul>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}
