import React from 'react';
import { api } from '../api';

/** Keep a broken view recoverable, and leave navigation available outside it. */
export class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void api.logRenderer(`${error.stack || error.message}\n${info.componentStack}`).catch(() => {});
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" style={{ flex: 1, overflow: 'auto', padding: 32, color: 'var(--text-1)', background: 'var(--bg-app)' }}>
      <h2>Something in this view broke</h2>
      <p>You can try this view again, or reload helm. Other pages are still available from the sidebar.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button onClick={() => this.setState({ failed: false })}>Try again</button>
        <button onClick={() => window.location.reload()}>Reload helm</button>
        <button onClick={() => { void api.saveDiagnostics().catch(() => {}); }}>Save diagnostics…</button>
      </div>
    </div>;
  }
}
