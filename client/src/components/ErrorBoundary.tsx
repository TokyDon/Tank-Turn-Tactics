import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: '32px',
          background: '#0d1117',
          color: '#f87171',
          fontFamily: 'monospace',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>⚠ Render Error</div>
          <div style={{ fontSize: '13px', color: '#e6edf3' }}>{this.state.error.message}</div>
          <pre style={{ fontSize: '11px', color: '#6e7681', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ alignSelf: 'flex-start', padding: '8px 16px', background: '#21262d', border: '1px solid #444', color: '#e6edf3', cursor: 'pointer', borderRadius: '4px' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
