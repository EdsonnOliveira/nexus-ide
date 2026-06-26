import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SidebarVercelIcon } from '@/components/sidebar/SidebarVercelIcon';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

interface SidebarVercelTokenPopupProps {
  anchorRect: DOMRect;
  tokenConfigured: boolean;
  onClose: () => void;
  onSaved: () => void;
  onCleared: () => void;
}

function SidebarVercelTokenPopupComponent({
  anchorRect,
  tokenConfigured,
  onClose,
  onSaved,
  onCleared,
}: SidebarVercelTokenPopupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
    'modal',
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target)) {
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

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!window.nexus?.vercel) {
        return;
      }

      const trimmed = tokenValue.trim();

      if (!trimmed) {
        setError('Informe um token da Vercel.');
        return;
      }

      setSaving(true);
      setError(null);

      try {
        const saved = await window.nexus.vercel.saveToken(trimmed);

        if (!saved) {
          setError('Token inválido ou sem permissão na Vercel.');
          return;
        }

        onSaved();
        requestClose();
      } finally {
        setSaving(false);
      }
    },
    [onSaved, requestClose, tokenValue],
  );

  const handleClear = useCallback(async () => {
    if (!window.nexus?.vercel) {
      return;
    }

    setClearing(true);
    setError(null);

    try {
      await window.nexus.vercel.clearToken();
      onCleared();
      requestClose();
    } finally {
      setClearing(false);
    }
  }, [onCleared, requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup sidebar-vercel-popup overlay-popup--anchor-start ${animationClass}`}
    >
      <form className='sidebar-vercel-popup__form' onSubmit={(event) => void handleSubmit(event)}>
        <div className='sidebar-vercel-popup__header'>
          <span className='sidebar-vercel-popup__badge' aria-hidden='true'>
            <SidebarVercelIcon size={14} />
          </span>
          <div className='sidebar-vercel-popup__intro'>
            <span className='sidebar-vercel-popup__title'>Token da Vercel</span>
            <span className='sidebar-vercel-popup__subtitle'>
              Monitore deploys em andamento de toda a sua conta.
            </span>
          </div>
        </div>

        <label className='sidebar-vercel-popup__field'>
          <span className='sidebar-vercel-popup__label'>Access Token</span>
          <input
            ref={inputRef}
            type='password'
            className='sidebar-vercel-popup__input'
            value={tokenValue}
            placeholder='vercel_...'
            autoComplete='off'
            onChange={(event) => {
              setTokenValue(event.target.value);

              if (error) {
                setError(null);
              }
            }}
          />
        </label>

        {error ? <span className='sidebar-vercel-popup__error'>{error}</span> : null}

        <button
          type='submit'
          className='sidebar-vercel-popup__submit app-button app-button--enter'
          disabled={saving || clearing}
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>

        {tokenConfigured ? (
          <button
            type='button'
            className='sidebar-vercel-popup__clear app-button app-button--enter'
            disabled={saving || clearing}
            onClick={() => void handleClear()}
          >
            {clearing ? 'Removendo...' : 'Remover token'}
          </button>
        ) : null}
      </form>
    </div>,
    document.body,
  );
}

export const SidebarVercelTokenPopup = memo(SidebarVercelTokenPopupComponent);
