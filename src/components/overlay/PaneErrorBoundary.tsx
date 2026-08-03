import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

import { NexusLogo } from '@/components/overlay/NexusLogo';

interface PaneErrorBoundaryProps {
  children: ReactNode;
}

interface PaneErrorBoundaryState {
  hasError: boolean;
  resetKey: number;
}

export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  state: PaneErrorBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<PaneErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[PaneErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState((prev) => ({
      hasError: false,
      resetKey: prev.resetKey + 1,
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
