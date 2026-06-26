import { Bot, Braces, Globe, Smartphone, Terminal } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { AutomationStepType } from '@/types/automation';
import { getAutomationStepLabel } from '@/utils/automationLabels';

interface AutomationActionLibraryProps {
  canAddMore: boolean;
  onAddStep: (type: AutomationStepType) => void;
}

const LIBRARY_ITEMS: {
  type: AutomationStepType;
  icon: typeof Terminal;
  className: string;
}[] = [
  { type: 'terminal', icon: Terminal, className: 'automation-action-library__item--terminal' },
  { type: 'agent', icon: Bot, className: 'automation-action-library__item--agent' },
  { type: 'browser', icon: Globe, className: 'automation-action-library__item--browser' },
  { type: 'emulator', icon: Smartphone, className: 'automation-action-library__item--emulator' },
  { type: 'api', icon: Braces, className: 'automation-action-library__item--api' },
];

function AutomationActionLibraryComponent({ canAddMore, onAddStep }: AutomationActionLibraryProps) {
  const [query, setQuery] = useState('');

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return LIBRARY_ITEMS;
    }

    return LIBRARY_ITEMS.filter((item) =>
      getAutomationStepLabel(item.type).toLowerCase().includes(normalized),
    );
  }, [query]);

  return (
    <aside className='automation-action-library'>
      <div className='automation-action-library__search-wrap'>
        <input
          className='automation-action-library__search'
          value={query}
          placeholder='Buscar ações'
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <span className='automation-action-library__heading'>Abas</span>
      <div className='automation-action-library__list'>
        {filteredItems.map(({ type, icon: Icon, className }) => (
          <button
            key={type}
            type='button'
            className={`automation-action-library__item app-button app-button--enter ${className}${canAddMore ? '' : ' automation-action-library__item--disabled'}`}
            disabled={!canAddMore}
            onClick={() => onAddStep(type)}
          >
            <Icon size={14} strokeWidth={2} aria-hidden />
            <span>{getAutomationStepLabel(type)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

export const AutomationActionLibrary = memo(AutomationActionLibraryComponent);
