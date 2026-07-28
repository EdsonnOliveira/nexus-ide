import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import { SidebarVercelIcon } from '@/components/sidebar/SidebarVercelIcon';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

const COPY_FEEDBACK_MS = 1500;

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
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const [tokenValue, setTokenValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loadingToken, setLoadingToken] = useState(tokenConfigured);
  const [copied, setCopied] = useState(false);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
    'modal',
  );

  useEffect(() => {
    let cancelled = false;

    if (!tokenConfigured || !window.nexus?.vercel?.getToken) {
      setLoadingToken(false);
      return;
    }

    setLoadingToken(true);

    void window.nexus.vercel.getToken().then((token) => {
      if (cancelled) {
        return;
      }

      if (token) {
        setTokenValue(token);
      }

      setLoadingToken(false);
    });

    return () => {
      cancelled = true;
    };
  }, [tokenConfigured]);

  useEffect(() => {
    if (loadingToken) {
      return;
    }

    inputRef.current?.focus();
  }, [loadingToken]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
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

  const handleCopy = useCallback(async () => {
    const trimmed = tokenValue.trim();

    if (!trimmed) {
      return;
    }

    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);

      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimeoutRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch {
      setError('Não foi possível copiar o token.');
    }
  }, [tokenValue]);

  const canCopy = tokenValue.trim().length > 0;

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
          <div className='sidebar-vercel-popup__input-row'>
            <input
              ref={inputRef}
              type='text'
              className='sidebar-vercel-popup__input'
              value={tokenValue}
              placeholder={loadingToken ? 'Carregando...' : 'vercel_...'}
              autoComplete='off'
              spellCheck={false}
              disabled={loadingToken}
              onChange={(event) => {
                setTokenValue(event.target.value);

                if (error) {
                  setError(null);
                }
              }}
            />
            <button
              type='button'
              className={`sidebar-vercel-popup__copy app-button app-button--enter${copied ? ' sidebar-vercel-popup__copy--copied' : ''}`}
              aria-label={copied ? 'Token copiado' : 'Copiar token'}
              title={copied ? 'Copiado' : 'Copiar'}
              disabled={!canCopy || loadingToken || saving || clearing}
              onClick={() => void handleCopy()}
            >
              <span
                className={`sidebar-vercel-popup__copy-icon${copied ? ' sidebar-vercel-popup__copy-icon--copied' : ''}`}
                aria-hidden='true'
              >
                <Copy size={13} strokeWidth={2.25} className='sidebar-vercel-popup__copy-icon-copy' />
                <Check
                  size={13}
                  strokeWidth={2.25}
                  className='sidebar-vercel-popup__copy-icon-check'
                />
              </span>
            </button>
          </div>
        </label>

        {error ? <span className='sidebar-vercel-popup__error'>{error}</span> : null}

        <button
          type='submit'
          className='sidebar-vercel-popup__submit app-button app-button--enter'
          disabled={saving || clearing || loadingToken}
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>

        {tokenConfigured ? (
          <button
            type='button'
            className='sidebar-vercel-popup__clear app-button app-button--enter'
            disabled={saving || clearing || loadingToken}
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
