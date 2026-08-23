import {
  DISMISS_FRACTION,
  type DragSample,
  releaseVelocity,
  settleSheet,
} from "@ui/components/sheet-math";
import { useHaptics } from "@ui/runtime/haptics";
import { Dialog } from "radix-ui";
import {
  type ReactElement,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/** Tall sheets rest at 65% of the viewport and drag up to 92%. */
const TALL_OPEN_VH = 0.65;
const TALL_FULL_VH = 0.92;
/** Resting offset of the 65% detent as a fraction of the 92%-tall panel;
 * mirrored by the `data-detent="open"` transform in components.css. */
const OPEN_DETENT_FRACTION = 1 - TALL_OPEN_VH / TALL_FULL_VH;

/** Travel before a touch claims the sheet drag, so taps stay taps. */
const DRAG_CLAIM_PX = 8;

type Detent = "full" | "open";

interface DragState {
  readonly startX: number;
  readonly startY: number;
  readonly baseY: number;
  readonly fromHandle: boolean;
  claimed: boolean;
  samples: DragSample[];
}

interface SheetProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  readonly children: ReactNode;
  /** `content` hugs the children (action/confirm sheets); `tall` opens at 65%
   * of the viewport with a draggable 92% detent (episode sheet). */
  readonly detents?: "content" | "tall";
}

/**
 * The base bottom sheet under every overlay: Radix Dialog (focus trap, Esc,
 * scrim dismiss, scroll lock) plus the phone grammar Radix doesn't do:
 * a grabber, finger-tracked drag-to-dismiss (release past 30% of the visible
 * sheet or a downward flick), and for tall sheets a 65%→92% detent pair.
 * The panel is labeled by the first heading its children render.
 */
export function Sheet({
  open,
  onOpenChange,
  children,
  detents = "content",
}: SheetProps): ReactElement {
  const tall = detents === "tall";
  const haptics = useHaptics();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const [dragY, setDragY] = useState<number | null>(null);
  const [detent, setDetent] = useState<Detent>(tall ? "open" : "full");
  const [labelledBy, setLabelledBy] = useState<string>();
  const headingId = useId();

  // Fresh presentation per open: back to the resting detent, no stale drag.
  useEffect(() => {
    if (!open) return;
    setDetent(tall ? "open" : "full");
    setDragY(null);
  }, [open, tall]);

  // Labels the dialog by the first heading its children render. A ref, not an
  // open-keyed effect: the Radix portal mounts a commit later than `open`
  // flips, so only the content ref sees the panel DOM reliably.
  const attachPanel = useCallback(
    (node: HTMLDivElement | null): void => {
      panelRef.current = node;
      const heading = node?.querySelector("h1, h2, h3");
      if (heading === null || heading === undefined) return;
      if (heading.id === "") heading.id = headingId;
      setLabelledBy(heading.id);
    },
    [headingId],
  );

  const detentOffsetPx = (): number => {
    const height = panelRef.current?.offsetHeight ?? 0;
    return detent === "open" ? height * OPEN_DETENT_FRACTION : 0;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const state = drag.current;
    drag.current = null;
    if (state === null || !state.claimed) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancelled) {
      setDragY(null);
      return;
    }
    const height = panelRef.current?.offsetHeight ?? 0;
    const openOffset = height * OPEN_DETENT_FRACTION;
    const stops = tall ? [0, openOffset] : [0];
    const lowest = tall ? openOffset : 0;
    const settle = settleSheet(
      state.samples[state.samples.length - 1]?.y ?? state.baseY,
      releaseVelocity(state.samples),
      stops,
      lowest + (height - lowest) * DISMISS_FRACTION,
    );
    if (settle.kind === "dismiss") {
      // Keep the dragged offset so the exit animation leaves from under the
      // finger instead of snapping back up first.
      onOpenChange(false);
      return;
    }
    setDragY(null);
    const next = settle.y > openOffset / 2 ? "open" : "full";
    // The panel arriving at the other detent is movement between two discrete
    // values; landing back where it started is not.
    if (next !== detent) haptics.selection();
    setDetent(next);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-scrim" />
        <Dialog.Content
          ref={attachPanel}
          className="sheet"
          aria-labelledby={labelledBy}
          aria-describedby={undefined}
          data-detents={detents}
          data-detent={detent}
          data-dragging={dragY !== null}
          // Focus the panel itself, not the first control: an auto-focused
          // button would sit ringed "at rest" before any keyboard intent. The
          // explicit focus (not just preventDefault) guarantees focus and the
          // SR announcement land inside the dialog on every Radix branch; the
          // panel's own `outline: none` keeps it ringless.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            panelRef.current?.focus();
          }}
          style={dragY === null ? undefined : { transform: `translateY(${dragY}px)` }}
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            drag.current = {
              startX: e.clientX,
              startY: e.clientY,
              baseY: detentOffsetPx(),
              fromHandle: (e.target as Element).closest(".sheet__handle") !== null,
              claimed: false,
              samples: [],
            };
          }}
          onPointerMove={(e) => {
            const state = drag.current;
            if (state === null) return;
            const dx = e.clientX - state.startX;
            const dy = e.clientY - state.startY;
            if (!state.claimed) {
              if (Math.abs(dx) >= DRAG_CLAIM_PX && Math.abs(dx) > Math.abs(dy)) {
                // Horizontal gesture: not ours (e.g. a pager swipe inside).
                drag.current = null;
                return;
              }
              if (Math.abs(dy) < DRAG_CLAIM_PX) return;
              const scrolled = (bodyRef.current?.scrollTop ?? 0) > 0;
              const claims = state.fromHandle || (dy > 0 ? !scrolled : state.baseY > 0);
              if (!claims) {
                drag.current = null;
                return;
              }
              state.claimed = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }
            const y = Math.max(0, state.baseY + (e.clientY - state.startY));
            state.samples.push({ t: e.timeStamp, y });
            setDragY(y);
          }}
          onPointerUp={(e) => endDrag(e, false)}
          onPointerCancel={(e) => endDrag(e, true)}
        >
          <div className="sheet__handle" aria-hidden="true">
            <span className="sheet__grabber" />
          </div>
          <div ref={bodyRef} className="sheet__body">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
