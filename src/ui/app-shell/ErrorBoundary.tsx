import { Component, type ErrorInfo, type ReactElement, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors anywhere below it so a thrown component never blanks the
 * whole app (the app-shell error boundary). Presents a
 * recover-in-place affordance rather than a raw stack.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Render error caught by boundary", error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return (
        <div className="boundary" role="alert" data-testid="error-boundary">
          <h1 className="boundary__title">Something went wrong</h1>
          <p className="boundary__body">
            The screen hit an unexpected error. Your data is safe — try again.
          </p>
          <button type="button" className="button" onClick={this.reset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children as ReactElement;
  }
}
