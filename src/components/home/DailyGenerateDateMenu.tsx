import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import {
  maskDailyDateInput,
  parseDailyDateInput,
  resolveDailyTargetDate,
} from '@/utils/dailyGenerateDate';

interface DailyGenerateDateMenuProps {
  anchorRect: DOMRect;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (date: Date) => void;
}

function DailyGenerateDateMenuComponent({
  anchorRect,
  triggerRef,
  onClose,
  onSelect,
}: DailyGenerateDateMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [customDate, setCustomDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || triggerRef?.current?.contains(target)) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown, true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [menuRef, requestClose, triggerRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  const handlePresetSelect = useCallback(
    (preset: 'today' | 'yesterday') => {
      onSelect(resolveDailyTargetDate(preset));
      requestClose();
    },
    [onSelect, requestClose],
  );

  const handleCustomSubmit = useCallback(() => {
    const parsed = parseDailyDateInput(customDate);

    if (!parsed) {
      setError('Informe uma data válida no formato DD/MM/AAAA.');
      return;
    }

    onSelect(parsed);
    requestClose();
  }, [customDate, onSelect, requestClose]);

  const handleCustomChange = useCallback((value: string) => {
    setCustomDate(maskDailyDateInput(value));
    setError(null);
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu home-dashboard__daily-generate-menu overlay-popup overlay-popup--anchor-end ${animationClass}`}
      role='menu'
    >
      <button
        type='button'
        className='context-menu__item app-button app-button--enter'
        role='menuitem'
        onClick={() => handlePresetSelect('today')}
      >
        Hoje
      </button>
      <button
        type='button'
        className='context-menu__item app-button app-button--enter'
        role='menuitem'
        onClick={() => handlePresetSelect('yesterday')}
      >
        Ontem
      </button>
      <div className='home-dashboard__daily-generate-menu-custom' role='none'>
        <label className='home-dashboard__daily-generate-menu-field'>
          <span className='home-dashboard__daily-generate-menu-label'>Outra data</span>
          <input
            ref={inputRef}
            type='text'
            inputMode='numeric'
            className='home-dashboard__daily-generate-menu-input'
            value={customDate}
            placeholder='DD/MM/AAAA'
            maxLength={10}
            aria-label='Informe a data no formato DD/MM/AAAA'
            onChange={(event) => handleCustomChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleCustomSubmit();
              }
            }}
          />
        </label>
        {error ? <p className='home-dashboard__daily-generate-menu-error'>{error}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

export const DailyGenerateDateMenu = memo(DailyGenerateDateMenuComponent);
