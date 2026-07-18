import { memo, useCallback, useEffect, useState } from 'react';
import { WebVercelIcon } from './WebVercelIcon';
import { validateWebVercelToken } from './webVercelApi';

interface WebVercelTokenModalProps {
  open: boolean;
  tokenConfigured: boolean;
  onClose: () => void;
  onSave: (token: string) => Promise<boolean>;
  onClear: () => Promise<void>;
}

function WebVercelTokenModalComponent({
  open,
  tokenConfigured,
  onClose,
  onSave,
  onClear,
}: WebVercelTokenModalProps) {
  const [tokenValue, setTokenValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTokenValue('');
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = tokenValue.trim();
      if (!trimmed) {
        setError('Informe o token da Vercel');
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const valid = await validateWebVercelToken(trimmed);
        if (!valid) {
          setError('Token inválido');
          return;
        }
        const saved = await onSave(trimmed);
        if (!saved) {
          setError('Não foi possível salvar o token');
          return;
        }
        onClose();
      } catch {
        setError('Não foi possível validar o token');
      } finally {
        setSaving(false);
      }
    },
    [onClose, onSave, tokenValue],
  );

  const handleClear = useCallback(async () => {
    setClearing(true);
    setError(null);
    try {
      await onClear();
      onClose();
    } catch {
      setError('Não foi possível remover o token');
    } finally {
      setClearing(false);
    }
  }, [onClear, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className='web-modal app-button--enter' role='presentation' onClick={onClose}>
      <div
        className='web-modal__card web-vercel-token-modal app-button--enter'
        role='dialog'
        aria-modal='true'
        aria-label='Token Vercel'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='web-vercel-token-modal__header'>
          <span className='web-vercel-token-modal__badge' aria-hidden='true'>
            <WebVercelIcon size={16} />
          </span>
          <div className='stack'>
            <strong>Vercel</strong>
            <span className='muted'>
              {tokenConfigured
                ? 'Token configurado. Você pode trocar ou remover.'
                : 'Cole um token da Vercel para ver deploys na web.'}
            </span>
          </div>
        </div>
        <form className='web-vercel-token-modal__form' onSubmit={(event) => void handleSubmit(event)}>
          <label className='web-vercel-token-modal__label' htmlFor='web-vercel-token'>
            Access Token
          </label>
          <input
            id='web-vercel-token'
            type='password'
            className='web-vercel-token-modal__input'
            value={tokenValue}
            placeholder='vercel_xxxxxxxx'
            autoComplete='off'
            spellCheck={false}
            onChange={(event) => setTokenValue(event.target.value)}
          />
          {error ? <p className='web-vercel-token-modal__error'>{error}</p> : null}
          <div className='web-vercel-token-modal__actions'>
            {tokenConfigured ? (
              <button
                type='button'
                className='app-button web-vercel-token-modal__secondary'
                disabled={clearing || saving}
                onClick={() => void handleClear()}
              >
                {clearing ? 'Removendo...' : 'Remover token'}
              </button>
            ) : null}
            <button
              type='button'
              className='app-button web-vercel-token-modal__secondary'
              disabled={saving || clearing}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type='submit'
              className='app-button web-vercel-token-modal__primary'
              disabled={saving || clearing}
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const WebVercelTokenModal = memo(WebVercelTokenModalComponent);
