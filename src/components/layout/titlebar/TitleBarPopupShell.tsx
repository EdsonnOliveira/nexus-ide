import { memo, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

interface TitleBarPopupShellProps {
  menuRef: RefObject<HTMLDivElement | null>;
  animationClass: string;
  title: string;
  ariaLabel?: string;
  popoverClassName?: string;
  panelClassName?: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

function TitleBarPopupShellComponent({
  menuRef,
  animationClass,
  title,
  ariaLabel,
  popoverClassName = '',
  panelClassName = '',
  onClose,
  children,
  actions,
}: TitleBarPopupShellProps) {
  return (
    <div
      ref={menuRef}
      className={`agent-cursor-usage__popover overlay-popup ${animationClass}${popoverClassName ? ` ${popoverClassName}` : ''}`}
      role='dialog'
      aria-label={ariaLabel ?? title}
    >
      <div className={`agent-cursor-usage__panel${panelClassName ? ` ${panelClassName}` : ''}`}>
        <div className='agent-cursor-usage__header'>
          <span className='agent-cursor-usage__title'>{title}</span>
          <button
            type='button'
            className='agent-cursor-usage__close app-button app-button--enter'
            aria-label='Fechar'
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {children}

        {actions ? <div className='agent-cursor-usage__actions'>{actions}</div> : null}
      </div>
    </div>
  );
}

export const TitleBarPopupShell = memo(TitleBarPopupShellComponent);
