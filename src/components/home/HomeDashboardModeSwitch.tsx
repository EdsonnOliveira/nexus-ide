import { LayoutGrid, Bot, CalendarDays, ListTodo } from 'lucide-react';
import { memo, useCallback } from 'react';

export type HomeDashboardViewMode = 'dashboard' | 'agent' | 'calendar' | 'tasks';

interface HomeDashboardModeSwitchProps {
  mode: HomeDashboardViewMode;
  onChange: (mode: HomeDashboardViewMode) => void;
  hasMaestroPing?: boolean;
}

function HomeDashboardModeSwitchComponent({
  mode,
  onChange,
  hasMaestroPing = false,
}: HomeDashboardModeSwitchProps) {
  const handleDashboard = useCallback(() => {
    onChange('dashboard');
  }, [onChange]);

  const handleAgent = useCallback(() => {
    onChange('agent');
  }, [onChange]);

  const handleCalendar = useCallback(() => {
    onChange('calendar');
  }, [onChange]);

  const handleTasks = useCallback(() => {
    onChange('tasks');
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
        className={`home-dashboard__mode-switch-btn app-button${mode === 'agent' ? ' home-dashboard__mode-switch-btn--active' : ''}${hasMaestroPing ? ' home-dashboard__mode-switch-btn--ping' : ''}`}
        onClick={handleAgent}
      >
        <span className='home-dashboard__mode-switch-icon-wrap'>
          <Bot size={14} strokeWidth={2.1} aria-hidden='true' />
          {hasMaestroPing ? (
            <span
              className='project-item__ping project-item__ping--red home-dashboard__mode-switch-ping'
              aria-hidden='true'
            />
          ) : null}
        </span>
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
      <button
        type='button'
        role='tab'
        aria-selected={mode === 'calendar'}
        className={`home-dashboard__mode-switch-btn app-button${mode === 'calendar' ? ' home-dashboard__mode-switch-btn--active' : ''}`}
        onClick={handleCalendar}
      >
        <CalendarDays size={14} strokeWidth={2.1} aria-hidden='true' />
        <span>Calendário</span>
      </button>
      <button
        type='button'
        role='tab'
        aria-selected={mode === 'tasks'}
        className={`home-dashboard__mode-switch-btn app-button${mode === 'tasks' ? ' home-dashboard__mode-switch-btn--active' : ''}`}
        onClick={handleTasks}
      >
        <ListTodo size={14} strokeWidth={2.1} aria-hidden='true' />
        <span>Tasks</span>
      </button>
    </div>
  );
}

export const HomeDashboardModeSwitch = memo(HomeDashboardModeSwitchComponent);
