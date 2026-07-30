import { memo, useCallback, useEffect, type ReactNode } from 'react';
import {
  ExternalLink,
  Loader2,
  Monitor,
  Play,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { useWebPreviewSession } from './useWebPreviewSession';

interface WebPreviewPanelProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string | null;
  projectId: string | null;
  deviceId: string | null;
  headerMacSelect?: ReactNode;
}

function WebPreviewPanelComponent({
  open,
  onClose,
  workspaceId,
  projectId,
  deviceId,
  headerMacSelect,
}: WebPreviewPanelProps) {
  const {
    publicUrl,
    localUrl,
    sessionState,
    sessionMessage,
    loading,
    error,
    iframeKey,
    startSession,
    stopSession,
    refreshIframe,
  } = useWebPreviewSession({
    workspaceId,
    projectId,
    deviceId,
    enabled: open,
  });

  const running = sessionState === 'running' && Boolean(publicUrl);

  const handleOpenExternal = useCallback(() => {
    if (!publicUrl) {
      return;
    }
    window.open(publicUrl, '_blank', 'noopener,noreferrer');
  }, [publicUrl]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className='web-preview-panel app-button--enter' role='main' aria-label='Front web remoto'>
      <div className='web-preview-panel__header'>
        <div className='web-preview-panel__title'>
          <Monitor size={16} aria-hidden='true' />
          <span>Front web</span>
          {sessionState !== 'stopped' ? (
            <span className='web-preview-panel__badge'>{sessionState}</span>
          ) : null}
        </div>
        <div className='web-preview-panel__header-actions'>
          {headerMacSelect ? (
            <div className='home-dashboard__header-mac'>{headerMacSelect}</div>
          ) : null}
          <button
            type='button'
            className='web-preview-panel__icon-btn app-button'
            disabled={!running || loading}
            aria-label='Atualizar'
            onClick={refreshIframe}
          >
            <RefreshCw size={15} aria-hidden='true' />
          </button>
          <button
            type='button'
            className='web-preview-panel__icon-btn app-button'
            disabled={!publicUrl}
            aria-label='Abrir em nova aba'
            onClick={handleOpenExternal}
          >
            <ExternalLink size={15} aria-hidden='true' />
          </button>
          {running ? (
            <button
              type='button'
              className='web-preview-panel__action app-button'
              disabled={loading}
              onClick={() => void stopSession()}
            >
              <Square size={14} aria-hidden='true' />
              Parar
            </button>
          ) : (
            <button
              type='button'
              className='web-preview-panel__action app-button'
              disabled={loading || !deviceId || !projectId}
              onClick={() => void startSession()}
            >
              {loading ? (
                <Loader2 size={14} className='web-preview-panel__spin' aria-hidden='true' />
              ) : (
                <Play size={14} aria-hidden='true' />
              )}
              Abrir front
            </button>
          )}
          <button
            type='button'
            className='web-preview-panel__icon-btn app-button'
            aria-label='Fechar front web'
            onClick={onClose}
          >
            <X size={16} aria-hidden='true' />
          </button>
        </div>
      </div>

      {localUrl ? (
        <p className='web-preview-panel__message'>Local: {localUrl}</p>
      ) : null}
      {sessionMessage ? <p className='web-preview-panel__message'>{sessionMessage}</p> : null}
      {error ? <p className='web-preview-panel__error'>{error}</p> : null}

      <div className='web-preview-panel__body'>
        {running && publicUrl ? (
          <iframe
            key={iframeKey}
            className='web-preview-panel__frame'
            title='Preview do front web'
            src={publicUrl}
            sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads'
            allow='clipboard-read; clipboard-write'
          />
        ) : (
          <div className='web-preview-panel__empty empty-state'>
            <div className='empty-state__icon'>
              <Monitor size={28} aria-hidden='true' />
            </div>
            <strong className='empty-state__title'>
              {loading ? 'Preparando preview…' : 'Front web'}
            </strong>
            <p className='empty-state__message'>
              {loading
                ? 'Criando túnel seguro até o Mac…'
                : localUrl
                  ? `Detectamos ${localUrl}. Toque em Abrir front.`
                  : 'Suba o front no Mac (npm run dev) e toque em Abrir front.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export const WebPreviewPanel = memo(WebPreviewPanelComponent);
