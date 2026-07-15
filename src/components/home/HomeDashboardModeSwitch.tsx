import { LayoutGrid, Bot } from 'lucide-react';
import { memo, useCallback } from 'react';

export type HomeDashboardViewMode = 'dashboard' | 'agent';

interface HomeDashboardModeSwitchProps {
  mode: HomeDashboardViewMode;
  onChange: (mode: HomeDashboardViewMode) => void;
}

function HomeDashboardModeSwitchComponent({ mode, onChange }: HomeDashboardModeSwitchProps) {
  const handleDashboard = useCallback(() => {
    onChange('dashboard');
  }, [onChange]);

  const handleAgent = useCallback(() => {
    onChange('agent');
  }, [onChange]);

  return (
    <div
      className={`home-dashboard__mode-switch home-dashboard__mode-switch--${mode}`}
      role='tablist'
      aria-label='Modo da home'
    >
      <span className='home-dashboard__mode-switch-thumb' aria-hidden='true' />
      <button
        type='button'
        role='tab'
        aria-selected={mode === 'agent'}
        className={`home-dashboard__mode-switch-btn app-button${mode === 'agent' ? ' home-dashboard__mode-switch-btn--active' : ''}`}
        onClick={handleAgent}
      >
        <Bot size={14} strokeWidth={2.1} aria-hidden='true' />
        <span>Maestro</span>
      </button>
      <button
        type='button'
        role='tab'
        aria-selected={mode === 'dashboard'}
        className={`home-dashboard__mode-switch-btn app-button${mode === 'dashboard' ? ' home-dashboard__mode-switch-btn--active' : ''}`}
        onClick={handleDashboard}
      >
        <LayoutGrid size={14} strokeWidth={2.1} aria-hidden='true' />
        <span>Dashboard</span>
      </button>
    </div>
  );
}

export const HomeDashboardModeSwitch = memo(HomeDashboardModeSwitchComponent);
