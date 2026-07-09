import { memo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { TestRunnerKind } from '@/types/test';
import { TEST_RUNNER_KINDS, TEST_RUNNER_LABELS } from '@/utils/testLabels';
import { TEST_RUNNER_ICON_SRC } from '@/utils/testRunnerIcons';

interface TestTypePickerPopupProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onSelect: (kind: TestRunnerKind) => void;
}

function TestTypePickerPopupComponent({ anchorRect, onClose, onSelect }: TestTypePickerPopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [requestClose, menuRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => Math.min(index + 1, TEST_RUNNER_KINDS.length - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const kind = TEST_RUNNER_KINDS[activeIndex];

        if (kind) {
          onSelect(kind);
          requestClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [activeIndex, onSelect, requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu tests-drawer__type-picker overlay-popup ${animationClass}`}
      role='menu'
      aria-label='Selecionar tipo de teste'
    >
      {TEST_RUNNER_KINDS.map((kind, index) => (
        <button
          key={kind}
          type='button'
          role='menuitem'
          className={`context-menu__item app-button app-button--enter${index === activeIndex ? ' context-menu__item--active' : ''}`}
          onClick={() => {
            onSelect(kind);
            requestClose();
          }}
        >
          <img
            src={TEST_RUNNER_ICON_SRC[kind]}
            alt=''
            className='tests-drawer__runner-icon'
            draggable={false}
            aria-hidden='true'
          />
          <span>{TEST_RUNNER_LABELS[kind]}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export const TestTypePickerPopup = memo(TestTypePickerPopupComponent);
