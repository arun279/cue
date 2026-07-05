import { createLazyRoute } from "@tanstack/react-router";
import { VirtualList } from "@ui/components/VirtualList";
import type { ReactElement } from "react";

const PLACEHOLDER_ROWS: readonly number[] = Array.from({ length: 1000 }, (_, index) => index);

function MyShowsScreen(): ReactElement {
  return (
    <section className="screen screen--full" data-testid="screen-my-shows">
      <h1 className="screen__title">My Shows</h1>
      <p className="screen__lead">
        Your whole library, grouped by status, will fill this space — kept smooth by windowing.
      </p>
      <VirtualList
        items={PLACEHOLDER_ROWS}
        estimateSize={56}
        label="Library placeholder rows"
        className="library-list"
        renderItem={(row) => <div className="library-row">Show slot {row + 1}</div>}
      />
    </section>
  );
}

export const Route = createLazyRoute("/my-shows")({ component: MyShowsScreen });
