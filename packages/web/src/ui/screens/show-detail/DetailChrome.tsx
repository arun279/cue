import { resolveBackdrop } from "@data/image-source";
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { artGradient } from "@ui/components/artGradient";
import { Poster } from "@ui/screens/up-next/Poster";
import { ChevronLeft, Ellipsis } from "lucide-react";
import { type ReactElement, useState } from "react";

/**
 * The floating hero chrome shared by the show and movie detail pages: solid
 * 44px discs over the artwork (no backdrop-filter; jank-prone on Android
 * WebView). Back pops the real entry point when there is in-app history;
 * a cold deep link falls back to a Library link so the page is never a dead end.
 */
export function BackDisc({
  testId = "detail-back",
  fallbackSearch,
}: {
  readonly testId?: string;
  /** Library search params for the cold-load fallback (e.g. the Movies tab). */
  readonly fallbackSearch?: { readonly type: "movies" };
}): ReactElement {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  if (!canGoBack) {
    return (
      <Link
        to="/library"
        {...(fallbackSearch === undefined ? {} : { search: fallbackSearch })}
        className="detail-disc detail-disc--back"
        aria-label="Back to Library"
        data-testid={testId}
      >
        <ChevronLeft aria-hidden="true" />
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="detail-disc detail-disc--back"
      aria-label="Back"
      data-testid={testId}
      onClick={() => router.history.back()}
    >
      <ChevronLeft aria-hidden="true" />
    </button>
  );
}

function OverflowDisc({
  label,
  onPress,
  testId = "detail-overflow",
}: {
  /** Accessible name, e.g. "More actions for The Wire". */
  readonly label: string;
  onPress(): void;
  readonly testId?: string;
}): ReactElement {
  return (
    <button
      type="button"
      className="detail-disc detail-disc--overflow"
      aria-label={label}
      aria-haspopup="dialog"
      data-testid={testId}
      onClick={onPress}
    >
      <Ellipsis aria-hidden="true" />
    </button>
  );
}

/**
 * The full-bleed hero shared by the show and movie pages: the backdrop
 * (fading in once decoded, or the monogram gradient plate with a centered
 * poster when there is none / it breaks), the status-bar scrim, the floating
 * back/overflow discs, and the title + quiet meta line. Each page keeps its own
 * meta composition and stable test ids.
 */
export function DetailHero({
  header,
  meta,
  testIds,
  onOverflow,
  backFallbackSearch,
}: {
  /** The show or movie header (structurally: title + art). */
  readonly header: {
    readonly title: string;
    readonly posters: readonly string[];
    readonly backdrops: readonly string[];
  };
  readonly meta: string;
  readonly testIds: {
    readonly hero: string;
    readonly backdrop: string;
    readonly title: string;
    readonly back?: string;
    readonly overflow?: string;
  };
  onOverflow(): void;
  /** Library search params for the back disc's cold-load fallback. */
  readonly backFallbackSearch?: { readonly type: "movies" };
}): ReactElement {
  const { title, posters, backdrops } = header;
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const backdrop = resolveBackdrop(backdrops);
  const showImage = backdrop !== null && !broken;
  return (
    <header className="detail-hero" data-testid={testIds.hero}>
      {showImage ? (
        <img
          className="detail-hero__backdrop"
          data-loaded={loaded}
          src={backdrop}
          alt=""
          decoding="async"
          data-testid={testIds.backdrop}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="detail-hero__plate"
          style={{ background: artGradient(title) }}
          aria-hidden="true"
        >
          <Poster title={title} posters={posters} variant="s96" />
        </span>
      )}
      <span className="detail-hero__scrim" aria-hidden="true" />
      <BackDisc
        {...(testIds.back === undefined ? {} : { testId: testIds.back })}
        {...(backFallbackSearch === undefined ? {} : { fallbackSearch: backFallbackSearch })}
      />
      <OverflowDisc
        label={`More actions for ${title}`}
        {...(testIds.overflow === undefined ? {} : { testId: testIds.overflow })}
        onPress={onOverflow}
      />
      <div className="detail-hero__stack">
        <h1 className="detail-hero__title" data-testid={testIds.title}>
          {title}
        </h1>
        {meta !== "" && <p className="detail-hero__meta">{meta}</p>}
      </div>
    </header>
  );
}
