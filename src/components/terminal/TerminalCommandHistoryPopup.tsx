import { memo, useEffect, useState } from 'react';
import type { ShellCommandHistoryEntry } from '@/stores/useShellCommandHistoryStore';
import { formatRelativeTimePt } from '@/utils/formatRelativeTimePt';

interface TerminalCommandHistoryPopupProps {
  entries: ShellCommandHistoryEntry[];
  selectedIndex: number;
  visible: boolean;
  top: number;
  left: number;
  onSelectIndex: (index: number) => void;
}

function TerminalCommandHistoryPopupComponent({
  entries,
  selectedIndex,
  visible,
  top,
  left,
  onSelectIndex,
}: TerminalCommandHistoryPopupProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!visible) {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [visible]);

  if (!visible || entries.length === 0) {
    return null;
  }

  return (
    <div
      className='terminal-command-history app-button--enter'
      style={{ top, left }}
      role='listbox'
      aria-label='Histórico de comandos'
    >
      <div className='terminal-command-history__hint'>
        <kbd className='global-search__key-badge'>↑</kbd>
        <kbd className='global-search__key-badge'>↓</kbd>
        <span className='terminal-command-history__hint-text'>para navegar</span>
        <span className='terminal-command-history__hint-sep'>·</span>
        <kbd className='global-search__key-badge'>esc</kbd>
        <span className='terminal-command-history__hint-text'>para fechar</span>
      </div>
      <div className='terminal-command-history__list'>
        {entries.map((entry, index) => {
          const selected = index === selectedIndex;

          return (
            <button
              key={`${entry.runAt}-${entry.command}-${index}`}
              type='button'
              role='option'
              aria-selected={selected}
              className={`terminal-command-history__item app-button${selected ? ' terminal-command-history__item--selected' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectIndex(index);
              }}
            >
              <span className='terminal-command-history__prompt' aria-hidden='true'>
                &gt;_
              </span>
              <span className='terminal-command-history__command'>{entry.command}</span>
              <span className='terminal-command-history__time'>
                {formatRelativeTimePt(entry.runAt, now)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const TerminalCommandHistoryPopup = memo(TerminalCommandHistoryPopupComponent);
