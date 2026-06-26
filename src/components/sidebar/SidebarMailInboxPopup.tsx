import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail } from 'lucide-react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { MailMailboxOption, MailMailboxRef } from '@/types';

interface SidebarMailInboxPopupProps {
  anchorRect: DOMRect;
  initialMailbox?: MailMailboxRef | null;
  submitOpensPanel?: boolean;
  onClose: () => void;
  onSave: (mailbox: MailMailboxRef) => void;
}

function encodeMailboxOptionId(mailbox: MailMailboxRef): string {
  const mailboxName = mailbox.mailboxName.trim() || 'INBOX';
  return `${mailbox.accountName}\u001d${mailboxName}`;
}

function SidebarMailInboxPopupComponent({
  anchorRect,
  initialMailbox = null,
  submitOpensPanel = true,
  onClose,
  onSave,
}: SidebarMailInboxPopupProps) {
  const [mailboxOptions, setMailboxOptions] = useState<MailMailboxOption[]>([]);
  const [loadingMailboxes, setLoadingMailboxes] = useState(true);
  const [selectedMailboxId, setSelectedMailboxId] = useState(
    initialMailbox ? encodeMailboxOptionId(initialMailbox) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
    'modal',
  );

  useEffect(() => {
    let cancelled = false;

    const loadMailboxes = async () => {
      if (!window.nexus?.mail) {
        if (!cancelled) {
          setLoadingMailboxes(false);
        }
        return;
      }

      try {
        const options = await window.nexus.mail.getMailboxes();

        if (!cancelled) {
          setMailboxOptions(options);
        }
      } finally {
        if (!cancelled) {
          setLoadingMailboxes(false);
        }
      }
    };

    void loadMailboxes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest('.anchored-select__menu')) {
        return;
      }

      requestClose();
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

  const selectOptions = useMemo(
    () => mailboxOptions.map((option) => ({ value: option.id, label: option.label })),
    [mailboxOptions],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const selectedOption = mailboxOptions.find((option) => option.id === selectedMailboxId);

      if (!selectedOption) {
        setError('Selecione uma conta de e-mail.');
        return;
      }

      onSave({
        accountName: selectedOption.accountName,
        mailboxName: selectedOption.mailboxName,
      });
      requestClose();
    },
    [mailboxOptions, onSave, requestClose, selectedMailboxId],
  );

  const handleMailboxChange = useCallback(
    (value: string) => {
      setSelectedMailboxId(value);

      if (error) {
        setError(null);
      }
    },
    [error],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup sidebar-mail-popup overlay-popup--anchor-start ${animationClass}`}
    >
      <form className='sidebar-mail-popup__form' onSubmit={handleSubmit}>
        <div className='sidebar-mail-popup__header'>
          <span className='sidebar-mail-popup__badge' aria-hidden='true'>
            <Mail size={14} />
          </span>
          <div className='sidebar-mail-popup__intro'>
            <span className='sidebar-mail-popup__title'>Conta de e-mail</span>
            <span className='sidebar-mail-popup__subtitle'>
              Vincule uma conta do Mail a este projeto.
            </span>
          </div>
        </div>

        {loadingMailboxes ? (
          <span className='sidebar-mail-popup__loading'>Carregando caixas...</span>
        ) : mailboxOptions.length === 0 ? (
          <EmptyState icon={Mail} message='Mail indisponível ou sem contas' compact />
        ) : (
          <label className='sidebar-mail-popup__field'>
            <span className='sidebar-mail-popup__label'>Conta de e-mail</span>
            <AnchoredSelect
              value={selectedMailboxId}
              options={selectOptions}
              allowEmpty
              emptyLabel='Selecione uma conta'
              onChange={handleMailboxChange}
              triggerClassName='sidebar-mail-popup__select'
              disabled={mailboxOptions.length === 0}
            />
          </label>
        )}

        {error ? <span className='sidebar-mail-popup__error'>{error}</span> : null}

        <button
          type='submit'
          className='sidebar-mail-popup__submit app-button app-button--enter'
          disabled={loadingMailboxes || mailboxOptions.length === 0}
        >
          {submitOpensPanel ? 'Salvar e abrir' : 'Salvar'}
        </button>
      </form>
    </div>,
    document.body,
  );
}

export const SidebarMailInboxPopup = memo(SidebarMailInboxPopupComponent);
