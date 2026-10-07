import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, isRecovering, recoverFromStaleChunk } from '../lib/chunkRecovery';
import { buttonClasses, Spinner } from './ui';

type Props = {
  children: ReactNode;
  /** When it changes (e.g. the pathname) a previous failure is forgotten, so navigating away from a broken screen works. */
  resetKey?: string;
  /** Takes the whole viewport (outside any layout) instead of filling the content area. */
  fullScreen?: boolean;
  /** Where «Volver al inicio» goes (the admin has its own home). */
  home?: string;
};

type State = { error: Error | null };

/**
 * Last line of defence against a blank screen: an unexpected render or route-loading error shows a human message instead.
 * It only catches errors *thrown while rendering* — failures of a screen's own data are handled by the screen (and keep
 * their specific message), so they are never mistaken for a fatal route error.
 */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('route render failed', error, info.componentStack);
    // A stale-bundle failure that Vite's event did not already handle (e.g. a browser-specific message): same single recovery.
    // The reload is now under way: re-render so the fallback gives way to the loading state before it is ever painted.
    if (isChunkLoadError(error) && recoverFromStaleChunk() === 'reloading') this.forceUpdate();
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    // The page is about to be replaced by the automatic reload: show the usual loading state, not an error flash.
    if (isRecovering()) return <Spinner />;
    return (
      <div
        role="alert"
        className={`mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center ${this.props.fullScreen ? 'min-h-dvh justify-center' : ''}`}
      >
        <h1 className="font-display text-xl font-extrabold">No pudimos cargar esta pantalla</h1>
        <p className="text-sm text-ink-muted">La aplicación pudo actualizarse mientras la estabas usando.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className={buttonClasses('primary')} onClick={() => window.location.reload()}>
            Recargar
          </button>
          <a className={buttonClasses('secondary')} href={this.props.home ?? '/'}>
            Volver al inicio
          </a>
        </div>
      </div>
    );
  }
}
