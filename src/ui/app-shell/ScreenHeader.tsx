import { Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft, CircleUserRound } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

interface ScreenHeaderProps {
  readonly title: string;
  /** `root` = tab-root header (title + avatar); `child` = back chevron + title. */
  readonly variant: "root" | "child";
  /** Optional control(s) rendered between the title and the trailing edge. */
  readonly trailing?: ReactNode;
}

/**
 * The one screen header: sticky, 56px + top safe inset, rendered by each screen
 * (the shell owns no chrome above the content). Root screens carry the avatar,
 * the sole path to Profile/Settings on the phone; child screens pop the real
 * history entry so back always retraces the arrival route.
 */
export function ScreenHeader({ title, variant, trailing }: ScreenHeaderProps): ReactElement {
  const router = useRouter();
  if (variant === "child") {
    return (
      <header className="app-header app-header--child">
        <button
          type="button"
          className="app-header__back"
          aria-label="Back"
          onClick={() => router.history.back()}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <h1 className="app-header__title">{title}</h1>
        {trailing}
      </header>
    );
  }
  return (
    <header className="app-header">
      <h1 className="app-header__title">{title}</h1>
      {trailing}
      <Link
        to="/profile"
        className="app-header__avatar"
        aria-label="Profile"
        data-testid="avatar-link"
      >
        <CircleUserRound aria-hidden="true" />
      </Link>
    </header>
  );
}
