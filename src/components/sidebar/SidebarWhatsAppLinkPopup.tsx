import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SidebarWhatsAppIcon } from '@/components/sidebar/SidebarWhatsAppIcon';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { parseSidebarWhatsAppLink } from '@/utils/sidebarWhatsAppLink';

interface SidebarWhatsAppLinkPopupProps {
  anchorRect: DOMRect;
  initialLink?: string;
  submitOpensLink?: boolean;
  onClose: () => void;
  onSave: (link: string) => void;
}

function SidebarWhatsAppLinkPopupComponent({
  anchorRect,
  initialLink = '',
  submitOpensLink = true,
  onClose,
  onSave,
}: SidebarWhatsAppLinkPopupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [linkValue, setLinkValue] = useState(initialLink);
  const [error, setError] = useState<string | null>(null);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
  }, [menuRef, requestClose]);

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

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const parsed = parseSidebarWhatsAppLink(linkValue);

      if (!parsed) {
        setError('Só aceitamos links oficiais do WhatsApp (wa.me, web.whatsapp.com, etc.).');
        return;
      }

      onSave(parsed);
      requestClose();
    },
    [linkValue, onSave, requestClose],
  );

  const handleLinkChange = useCallback(
    (value: string) => {
      setLinkValue(value);

      if (error) {
        setError(null);
      }
    },
    [error],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup sidebar-whatsapp-popup overlay-popup--anchor-start ${animationClass}`}
    >
      <form className='sidebar-whatsapp-popup__form' onSubmit={handleSubmit}>
        <div className='sidebar-whatsapp-popup__header'>
          <span className='sidebar-whatsapp-popup__badge' aria-hidden='true'>
            <SidebarWhatsAppIcon size={14} />
          </span>
          <div className='sidebar-whatsapp-popup__intro'>
            <span className='sidebar-whatsapp-popup__title'>Conversa no WhatsApp</span>
            <span className='sidebar-whatsapp-popup__subtitle'>
              Abra a conversa sem sair do fluxo de trabalho.
            </span>
          </div>
        </div>

        <label className='sidebar-whatsapp-popup__field'>
          <span className='sidebar-whatsapp-popup__label'>Link da conversa</span>
          <input
            ref={inputRef}
            type='url'
            className='sidebar-whatsapp-popup__input'
            value={linkValue}
            placeholder='https://wa.me/5511999999999 ou chat.whatsapp.com/...'
            onChange={(event) => handleLinkChange(event.target.value)}
          />
        </label>

        {error ? <span className='sidebar-whatsapp-popup__error'>{error}</span> : null}

        <button type='submit' className='sidebar-whatsapp-popup__submit app-button app-button--enter'>
          {submitOpensLink ? 'Abrir conversa' : 'Salvar'}
        </button>
      </form>
    </div>,
    document.body,
  );
}

export const SidebarWhatsAppLinkPopup = memo(SidebarWhatsAppLinkPopupComponent);
