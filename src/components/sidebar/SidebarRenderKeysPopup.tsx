import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Trash2 } from 'lucide-react';
import { SidebarRenderIcon } from '@/components/sidebar/SidebarRenderIcon';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { RenderCredentialSummary } from '@/types';

const COPY_FEEDBACK_MS = 1500;

interface SidebarRenderKeysPopupProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onChanged: () => void;
}

function SidebarRenderKeysPopupComponent({
  anchorRect,
  onClose,
  onChanged,
}: SidebarRenderKeysPopupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const copiedKeyTimeoutRef = useRef<number | null>(null);
  const [keys, setKeys] = useState<RenderCredentialSummary[]>([]);
  const [tokenValue, setTokenValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
    'modal',
  );

  const loadKeys = useCallback(async () => {
    if (!window.nexus?.render) {
      setLoadingKeys(false);
      return;
    }

    try {
      const items = await window.nexus.render.listKeys();
      setKeys(items);
    } catch {
      setKeys([]);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    if (loadingKeys) {
      return;
    }

    inputRef.current?.focus();
  }, [loadingKeys]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }

      if (copiedKeyTimeoutRef.current !== null) {
        window.clearTimeout(copiedKeyTimeoutRef.current);
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
      window.addEventListener('mousedown', handlePointerDown, true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown, true);
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

      if (!window.nexus?.render) {
        return;
      }

      const trimmed = tokenValue.trim();

      if (!trimmed) {
        setError('Informe uma API key da Render.');
        return;
      }

      setSaving(true);
      setError(null);

      try {
        const result = await window.nexus.render.addKey(trimmed);

        if (result === 'invalid' || result === 'empty') {
          setError('API key inválida ou sem permissão na Render.');
          return;
        }

        if (result === 'duplicate') {
          setError('Essa API key já foi adicionada.');
          return;
        }

        setTokenValue('');
        await loadKeys();
        onChanged();
      } catch {
        setError('Não foi possível salvar a API key.');
      } finally {
        setSaving(false);
      }
    },
    [loadKeys, onChanged, tokenValue],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      if (!window.nexus?.render) {
        return;
      }

      setRemovingId(id);
      setError(null);

      try {
        await window.nexus.render.removeKey(id);
        await loadKeys();
        onChanged();
      } catch {
        setError('Não foi possível remover a API key.');
      } finally {
        setRemovingId(null);
      }
    },
    [loadKeys, onChanged],
  );

  const handleCopyInput = useCallback(async () => {
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
      setError('Não foi possível copiar a API key.');
    }
  }, [tokenValue]);

  const handleCopyKey = useCallback(async (id: string) => {
    if (!window.nexus?.render) {
      return;
    }

    try {
      const token = await window.nexus.render.getKeyToken(id);

      if (!token) {
        setError('Não foi possível copiar a API key.');
        return;
      }

      await navigator.clipboard.writeText(token);
      setCopiedKeyId(id);

      if (copiedKeyTimeoutRef.current !== null) {
        window.clearTimeout(copiedKeyTimeoutRef.current);
      }

      copiedKeyTimeoutRef.current = window.setTimeout(() => {
        setCopiedKeyId(null);
        copiedKeyTimeoutRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch {
      setError('Não foi possível copiar a API key.');
    }
  }, []);

  const canCopy = tokenValue.trim().length > 0;
  const busy = saving || removingId !== null || loadingKeys;

  return createPortal(
    <>
      <div
        className='overlay-popup-scrim'
        onMouseDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
      />
      <div
        ref={menuRef}
        className={`overlay-popup sidebar-vercel-popup overlay-popup--anchor-start ${animationClass}`}
      >
      <form className='sidebar-vercel-popup__form' onSubmit={(event) => void handleSubmit(event)}>
        <div className='sidebar-vercel-popup__header'>
          <span className='sidebar-vercel-popup__badge' aria-hidden='true'>
            <SidebarRenderIcon size={14} />
          </span>
          <div className='sidebar-vercel-popup__intro'>
            <span className='sidebar-vercel-popup__title'>API keys da Render</span>
            <span className='sidebar-vercel-popup__subtitle'>
              Adicione uma ou mais keys para monitorar deploys de todas as contas.
            </span>
          </div>
        </div>

        {keys.length > 0 ? (
          <ul className='sidebar-render-popup__keys'>
            {keys.map((key) => {
              const keyCopied = copiedKeyId === key.id;

              return (
                <li key={key.id} className='sidebar-render-popup__key'>
                  <span className='sidebar-render-popup__key-label' title={key.label}>
                    {key.label}
                  </span>
                  <div className='sidebar-render-popup__key-actions'>
                    <button
                      type='button'
                      className={`sidebar-vercel-popup__copy app-button app-button--enter${keyCopied ? ' sidebar-vercel-popup__copy--copied' : ''}`}
                      aria-label={keyCopied ? 'API key copiada' : 'Copiar API key'}
                      title={keyCopied ? 'Copiado' : 'Copiar'}
                      disabled={busy}
                      onClick={() => void handleCopyKey(key.id)}
                    >
                      <span
                        className={`sidebar-vercel-popup__copy-icon${keyCopied ? ' sidebar-vercel-popup__copy-icon--copied' : ''}`}
                        aria-hidden='true'
                      >
                        <Copy
                          size={13}
                          strokeWidth={2.25}
                          className='sidebar-vercel-popup__copy-icon-copy'
                        />
                        <Check
                          size={13}
                          strokeWidth={2.25}
                          className='sidebar-vercel-popup__copy-icon-check'
                        />
                      </span>
                    </button>
                    <button
                      type='button'
                      className='sidebar-render-popup__remove app-button app-button--enter'
                      aria-label={`Remover ${key.label}`}
                      title='Remover'
                      disabled={busy}
                      onClick={() => void handleRemove(key.id)}
                    >
                      <Trash2 size={13} strokeWidth={2.25} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <label className='sidebar-vercel-popup__field'>
          <span className='sidebar-vercel-popup__label'>API Key</span>
          <div className='sidebar-vercel-popup__input-row'>
            <input
              ref={inputRef}
              type='text'
              className='sidebar-vercel-popup__input'
              value={tokenValue}
              placeholder={loadingKeys ? 'Carregando...' : 'rnd_...'}
              autoComplete='off'
              spellCheck={false}
              disabled={loadingKeys}
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
              aria-label={copied ? 'API key copiada' : 'Copiar API key'}
              title={copied ? 'Copiado' : 'Copiar'}
              disabled={!canCopy || busy}
              onClick={() => void handleCopyInput()}
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
          disabled={busy}
        >
          {saving ? 'Adicionando...' : 'Adicionar'}
        </button>
      </form>
    </div>
    </>,
    document.body,
  );
}

export const SidebarRenderKeysPopup = memo(SidebarRenderKeysPopupComponent);
