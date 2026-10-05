import { Component, ErrorInfo, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './i18n';

// Import background processor to start automated trading logic
import backgroundProcessor from './background/processor';

// Ensure background processor is initialized
console.log('Background processor initialized:', backgroundProcessor.isRunning ? 'running' : 'not running');

class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, details: ErrorInfo) {
    console.error('Application render failed:', error, details);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="app-booting">
          <div className="app-booting__content">
            <p className="app-booting__title">We could not open your workspace</p>
            <p className="app-booting__message">Refresh the page. If the problem continues, sign out, clear this site’s cached data, and sign in again.</p>
            <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-blue-600 px-5 py-2.5 font-semibold text-white hover:bg-blue-500">
              Reload application
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
