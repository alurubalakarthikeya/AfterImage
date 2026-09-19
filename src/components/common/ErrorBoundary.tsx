import { Component, type ErrorInfo, type ReactNode } from 'react';
import { cn } from '@/utils/format';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  /** What to call the failed region: "workspace", "inspector". */
  region?: string;
  className?: string;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary.
 *
 * A desktop application should never turn into a blank window because one
 * panel threw. This keeps the shell — sidebar, search, window controls —
 * alive, names the region that failed, and offers a retry. Boundaries are per
 * region rather than global for exactly that reason.
 *
 * React only ships class-based boundaries; that is why this file is not a
 * function component like every other one in the tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept as a console error on purpose: in the packaged app this is the
    // fastest path to a bug report, and the archive itself is never at risk.
    console.error(`AfterImage: the ${this.props.region ?? 'panel'} failed to render`, error, info);
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={cn('flex h-full items-start justify-center p-6', this.props.className)}>
        <div className="w-full max-w-[420px] rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-2 text-ink">
            <Icon name="AlertTriangle" size={15} strokeWidth={1.9} className="text-caution" />
            <span className="text-card font-semibold">
              The {this.props.region ?? 'panel'} stopped responding
            </span>
          </div>

          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            Nothing was changed or deleted — this view failed to render. The rest of the window is
            still usable.
          </p>

          <pre
            data-selectable
            className="mt-3 max-h-[120px] overflow-auto rounded-panel bg-sunken px-3 py-2 font-mono text-[11px] leading-[1.5] text-ink-2"
          >
            {error.message}
          </pre>

          <button
            type="button"
            onClick={this.reset}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-btn bg-accent-strong px-3 text-meta font-medium text-white transition-colors duration-150 hover:bg-accent"
          >
            <Icon name="RefreshCw" size={13} strokeWidth={2.2} />
            Reload this panel
          </button>
        </div>
      </div>
    );
  }
}
