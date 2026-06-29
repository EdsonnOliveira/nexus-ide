import { Component, type ErrorInfo, type ReactNode } from 'react';

interface PaneErrorBoundaryProps {
  children: ReactNode;
}

interface PaneErrorBoundaryState {
  hasError: boolean;
}

export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  state: PaneErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PaneErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[PaneErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className='app-loading'>
          <div className='empty-state'>
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

    return this.props.children;
  }
}
