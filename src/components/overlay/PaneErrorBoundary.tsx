import { Component, type ErrorInfo, type ReactNode } from 'react';

import { NexusLogo } from '@/components/overlay/NexusLogo';

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
    // #region agent log
    fetch('http://127.0.0.1:7573/ingest/667eb7be-70f4-44cb-a19a-5ae8dc0f89e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f47fa1'},body:JSON.stringify({sessionId:'f47fa1',location:'PaneErrorBoundary.tsx:catch',message:'pane error',data:{error:error.message,stack:error.stack?.slice(0,500)},timestamp:Date.now(),hypothesisId:'H15',runId:'post-fix'})}).catch(()=>{});
    // #endregion
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
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

    return this.props.children;
  }
}
