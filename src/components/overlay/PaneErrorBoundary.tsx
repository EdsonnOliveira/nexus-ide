import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

import { NexusLogo } from '@/components/overlay/NexusLogo';

interface PaneErrorBoundaryProps {
  children: ReactNode;
}

interface PaneErrorBoundaryState {
  hasError: boolean;
  resetKey: number;
  errorMessage: string | null;
}

export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  state: PaneErrorBoundaryState = { hasError: false, resetKey: 0, errorMessage: null };

  static getDerivedStateFromError(error: Error): Partial<PaneErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error?.message ? String(error.message) : 'Unknown error',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[PaneErrorBoundary]', error, info.componentStack);
    try {
      (window as Window & { __NEXUS_LAST_PANE_ERROR?: string }).__NEXUS_LAST_PANE_ERROR =
        `${error?.stack || error?.message || String(error)}\n${info.componentStack || ''}`;
    } catch {
    }
  }

  private handleRetry = (): void => {
    const message = this.state.errorMessage ?? '';
    if (
      message.includes('getSnapshot') ||
      message.includes('Hooks') ||
      message.includes('Failed to fetch dynamically imported module')
    ) {
      window.location.reload();
      return;
    }

    this.setState((prev) => ({
      hasError: false,
      resetKey: prev.resetKey + 1,
      errorMessage: null,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className='app-loading'>
          <div className='empty-state'>
            <div className='empty-state__icon' aria-hidden='true'>
              <NexusLogo size={40} className='nexus-brand-logo' />
            </div>
            <span className='empty-state__title'>Erro ao carregar a interface</span>
            <span>Reinicie o app ou tente novamente</span>
            {this.state.errorMessage ? (
              <span className='empty-state__detail'>{this.state.errorMessage}</span>
            ) : null}
            <button
              type='button'
              className='empty-state__action app-button app-button--enter'
              onClick={this.handleRetry}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
