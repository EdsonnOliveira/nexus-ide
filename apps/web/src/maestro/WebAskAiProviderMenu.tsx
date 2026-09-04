import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import logoAntigravity from '../assets/logo-antigravity.svg';
import logoClaude from '../assets/logo-claude.svg';
import logoCodex from '../assets/logo-codex.svg';
import logoCursor from '../assets/logo-cursor.svg';
import logoOpencode from '../assets/logo-opencode.svg';
import { WEB_ASK_AI_PROVIDER_OPTIONS, type WebAskAiProviderId } from './webAiProviders';

export const WEB_ASK_AI_PROVIDER_LOGOS: Record<WebAskAiProviderId, string> = {
  cursor: logoCursor,
  claude: logoClaude,
  codex: logoCodex,
  opencode: logoOpencode,
  antigravity: logoAntigravity,
};

function WebAskAiProviderLogoComponent({ provider }: { provider: WebAskAiProviderId }) {
  return (
    <i className='home-dashboard__ask-ai-logo-wrap' aria-hidden='true'>
      <img
        src={WEB_ASK_AI_PROVIDER_LOGOS[provider]}
        alt=''
        className='home-dashboard__ask-ai-logo'
        draggable={false}
      />
    </i>
  );
}

const WebAskAiProviderLogo = memo(WebAskAiProviderLogoComponent);

interface WebAskAiProviderMenuProps {
  value: WebAskAiProviderId;
  disabled?: boolean;
  onChange: (provider: WebAskAiProviderId) => void;
}

export function WebAskAiProviderMenu({
  value,
  disabled = false,
  onChange,
}: WebAskAiProviderMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const selectedLabel =
    WEB_ASK_AI_PROVIDER_OPTIONS.find((option) => option.id === value)?.label ?? 'Cursor';

  const close = useCallback(() => {
    setPhase('out');
  }, []);

  const openMenu = useCallback(() => {
    const next = triggerRef.current?.getBoundingClientRect() ?? null;
    setRect(next);
    setPhase('in');
    setOpen(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !rect) {
      return;
    }
    const update = () => {
      setRect(triggerRef.current?.getBoundingClientRect() ?? null);
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, rect]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className={`home-dashboard__ask-action app-button${
          open ? ' home-dashboard__ask-action--open' : ''
        }`}
        aria-label={`IA deste agent: ${selectedLabel}`}
        aria-haspopup='menu'
        aria-expanded={open}
        title={`IA deste agent: ${selectedLabel}`}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          openMenu();
        }}
      >
        <WebAskAiProviderLogo provider={value} />
      </button>
      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              className={`context-menu overlay-popup overlay-popup--${phase}`}
              role='menu'
              aria-label='IA deste agent'
              style={{
                left: Math.max(12, Math.min(rect.right - 180, window.innerWidth - 200)),
                bottom: window.innerHeight - rect.top + 6,
                zIndex: 10000,
              }}
              onAnimationEnd={() => {
                if (phase === 'out') {
                  setOpen(false);
                }
              }}
            >
              {WEB_ASK_AI_PROVIDER_OPTIONS.map((option) => {
                const active = option.id === value;
                return (
                  <button
                    key={option.id}
                    type='button'
                    className={`context-menu__item app-button app-button--enter${
                      active ? ' context-menu__item--active' : ''
                    }`}
                    role='menuitem'
                    onClick={() => {
                      onChange(option.id);
                      close();
                    }}
                  >
                    <WebAskAiProviderLogo provider={option.id} />
                    <span>{option.label}</span>
                    {active ? <Check size={14} strokeWidth={2} aria-hidden='true' /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
