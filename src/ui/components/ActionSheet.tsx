import { Sheet } from "@ui/components/Sheet";
import type { ReactElement, ReactNode } from "react";

export interface ActionSheetRow {
  readonly label: string;
  /** Optional leading 20px icon, e.g. a lucide glyph. */
  readonly icon?: ReactNode;
  /** Destructive rows read in the danger tint. */
  readonly danger?: boolean;
  readonly testId?: string;
  onPress(): void;
}

interface ActionSheetProps {
  readonly open: boolean;
  onOpenChange(open: boolean): void;
  /** Names what the actions apply to (show / entry title); labels the dialog. */
  readonly title: string;
  readonly rows: readonly ActionSheetRow[];
}

/**
 * A titled list of full-width action rows in a content-height Sheet: the one
 * menu surface on a phone (overflow menus, sort pickers, long-press actions
 * all share it). A row runs its action and the sheet dismisses itself.
 */
export function ActionSheet({ open, onOpenChange, title, rows }: ActionSheetProps): ReactElement {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <div className="sheet-menu">
        <h2 className="sheet-menu__title">{title}</h2>
        {rows.map((row) => (
          <button
            key={row.label}
            type="button"
            className="sheet-menu__row"
            data-danger={row.danger === true || undefined}
            {...(row.testId === undefined ? {} : { "data-testid": row.testId })}
            onClick={() => {
              row.onPress();
              onOpenChange(false);
            }}
          >
            {row.icon !== undefined && (
              <span className="sheet-menu__icon" aria-hidden="true">
                {row.icon}
              </span>
            )}
            {row.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
