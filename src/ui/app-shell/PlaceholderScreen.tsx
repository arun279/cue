import type { ReactElement, ReactNode } from "react";

interface PlaceholderScreenProps {
  title: string;
  description: string;
  testId: string;
  children?: ReactNode;
}

/**
 * Frame stand-in for a not-yet-built screen. Later work replaces each
 * route's body with the real screen; this keeps every destination reachable and
 * legible in the meantime.
 */
export function PlaceholderScreen({
  title,
  description,
  testId,
  children,
}: PlaceholderScreenProps): ReactElement {
  return (
    <section className="screen" data-testid={testId}>
      <h1 className="screen__title">{title}</h1>
      <p className="screen__lead">{description}</p>
      {children}
    </section>
  );
}
