import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CirclePlay } from 'lucide-react';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import {
  SIDEBAR_VIDEO_PROVIDER_LABELS,
  detectSidebarVideoProvider,
  isYouTubeLiveUrl,
  parseSidebarVideoLink,
  type SidebarVideoSession,
} from '@/utils/sidebarVideoProviders';

interface SidebarVideoLinkPopupProps {
  anchorRect: DOMRect;
  initialLink?: string;
  onClose: () => void;
  onStart: (session: SidebarVideoSession, lastLink: string) => void;
}

const SUPPORTED_PROVIDERS = ['youtube', 'prime', 'disney', 'netflix'] as const;

function SidebarVideoLinkPopupComponent({
  anchorRect,
  initialLink = '',
  onClose,
  onStart,
}: SidebarVideoLinkPopupProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [linkValue, setLinkValue] = useState(initialLink);
  const [error, setError] = useState<string | null>(null);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    setLinkValue(initialLink);
  }, [initialLink]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
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

      const session = parseSidebarVideoLink(linkValue);

      if (!session) {
        setError('Só aceitamos links oficiais do YouTube, Prime Video, Disney+ ou Netflix.');
        return;
      }

      const isLive = isYouTubeLiveUrl(linkValue);

      onStart(
        {
          ...session,
          isLive,
          useEmbed: session.provider === 'youtube' ? false : !isLive,
        },
        linkValue.trim(),
      );
      requestClose();
    },
    [linkValue, onStart, requestClose],
  );

  const handleLinkChange = useCallback((value: string) => {
    setLinkValue(value);

    if (error) {
      setError(null);
    }
  }, [error]);

  const detectedProvider = useMemo(() => detectSidebarVideoProvider(linkValue), [linkValue]);

  const submitLabel = useMemo(() => {
    if (detectedProvider === 'youtube' && isYouTubeLiveUrl(linkValue)) {
      return 'Assistir live';
    }

    if (detectedProvider === 'youtube') {
      return 'Assistir vídeo';
    }

    if (detectedProvider) {
      return 'Assistir série';
    }

    return 'Abrir PiP';
  }, [detectedProvider, linkValue]);

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup sidebar-video-popup overlay-popup--anchor-start ${animationClass}`}
    >
      <form className='sidebar-video-popup__form' onSubmit={handleSubmit}>
        <div className='sidebar-video-popup__header'>
          <span className='sidebar-video-popup__badge' aria-hidden='true'>
            <CirclePlay size={14} strokeWidth={2} />
          </span>
          <div className='sidebar-video-popup__intro'>
            <span className='sidebar-video-popup__title'>PiP na sidebar</span>
            <span className='sidebar-video-popup__subtitle'>
              Transforme a pausa em progresso — assista sem sair do fluxo.
            </span>
          </div>
        </div>

        <label className='sidebar-video-popup__field'>
          <span className='sidebar-video-popup__label'>Link do episódio</span>
          <input
            ref={inputRef}
            type='url'
            className='sidebar-video-popup__input'
            value={linkValue}
            placeholder='Cole a URL do YouTube (vídeo ou live), Prime Video, Disney+ ou Netflix'
            onChange={(event) => handleLinkChange(event.target.value)}
          />
        </label>

        <div className='sidebar-video-popup__providers' aria-label='Plataformas suportadas'>
          {SUPPORTED_PROVIDERS.map((provider) => (
            <span
              key={provider}
              className={`sidebar-video-popup__provider${
                detectedProvider === provider
                  ? ` sidebar-video-popup__provider--active sidebar-video-popup__provider--${provider}`
                  : ''
              }`}
            >
              {SIDEBAR_VIDEO_PROVIDER_LABELS[provider]}
            </span>
          ))}
        </div>

        {error ? <span className='sidebar-video-popup__error'>{error}</span> : null}

        <button type='submit' className='sidebar-video-popup__submit app-button app-button--enter'>
          {submitLabel}
        </button>
      </form>
    </div>,
    document.body,
  );
}

export const SidebarVideoLinkPopup = memo(SidebarVideoLinkPopupComponent);
