import { ActionSheet, type ActionSheetRow } from "@ui/components/ActionSheet";
import { exceedsPressSlop, LONG_PRESS_MS } from "@ui/components/long-press-math";
import { useHaptics } from "@ui/runtime/haptics";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";

interface ContextMenuProps {
  /** Names what the menu applies to (entry / show title); labels the sheet. */
  readonly title: string;
  readonly rows: readonly ActionSheetRow[];
  readonly children: ReactNode;
}

/**
 * The long-press menu: hold the wrapped child 500ms (or right-click on
 * desktop) to open its actions as an ActionSheet. Phones don't do floating
 * menus well, so every menu shares the one bottom-sheet grammar. Movement past
 * the slop or an early lift cancels the hold; a fired hold swallows the click
 * that follows so the child's own tap action never double-fires.
 */
export function ContextMenu({ title, rows, children }: ContextMenuProps): ReactElement {
  const haptics = useHaptics();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const fired = useRef(false);

  const cancelHold = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <>
      {/* A pure gesture layer, not a widget: the hold is an accelerator and the
          sheet's actions all have visible tap paths of their own. */}
      <div
        className="context-menu-target"
        role="none"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          start.current = { x: e.clientX, y: e.clientY };
          fired.current = false;
          timer.current = setTimeout(() => {
            timer.current = null;
            fired.current = true;
            // The hold has no visual tell until the sheet animates in, so the
            // tap is what tells the finger the menu is coming.
            haptics.contextClick();
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerMove={(e) => {
          const from = start.current;
          if (from === null) return;
          if (exceedsPressSlop(e.clientX - from.x, e.clientY - from.y)) cancelHold();
        }}
        onPointerUp={cancelHold}
        onPointerCancel={cancelHold}
        onClickCapture={(e) => {
          if (!fired.current) return;
          fired.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </div>
      <ActionSheet open={open} onOpenChange={setOpen} title={title} rows={rows} />
    </>
  );
}
