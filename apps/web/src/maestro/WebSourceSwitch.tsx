import { Globe, Monitor } from 'lucide-react';
import { memo, useCallback } from 'react';

export type WebHomeSource = 'web' | 'desktop';

interface WebSourceSwitchProps {
  source: WebHomeSource;
  onChange: (source: WebHomeSource) => void;
}

function WebSourceSwitchComponent({ source, onChange }: WebSourceSwitchProps) {
  const handleWeb = useCallback(() => {
    onChange('web');
  }, [onChange]);

  const handleDesktop = useCallback(() => {
    onChange('desktop');
  }, [onChange]);

  return (
    <div
      className={`home-dashboard__mode-switch home-dashboard__mode-switch--source home-dashboard__mode-switch--${source}`}
      role='tablist'
      aria-label='Origem dos agents'
    >
      <span className='home-dashboard__mode-switch-thumb' aria-hidden='true' />
      <button
        type='button'
        role='tab'
        aria-selected={source === 'web'}
        aria-label='Web'
        className={`home-dashboard__mode-switch-btn app-button${source === 'web' ? ' home-dashboard__mode-switch-btn--active' : ''}`}
        onClick={handleWeb}
      >
        <Globe size={14} strokeWidth={2.1} aria-hidden='true' />
        <span>Web</span>
      </button>
      <button
        type='button'
        role='tab'
        aria-selected={source === 'desktop'}
        aria-label='Desktop'
        className={`home-dashboard__mode-switch-btn app-button${source === 'desktop' ? ' home-dashboard__mode-switch-btn--active' : ''}`}
        onClick={handleDesktop}
      >
        <Monitor size={14} strokeWidth={2.1} aria-hidden='true' />
        <span>Desktop</span>
      </button>
    </div>
  );
}

export const WebSourceSwitch = memo(WebSourceSwitchComponent);
