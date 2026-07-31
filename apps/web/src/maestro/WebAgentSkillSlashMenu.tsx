import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen } from 'lucide-react';
import type { WebSkillSlashMatch } from './webAgentSkillSlash';

interface WebAgentSkillSlashMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  matches: WebSkillSlashMatch[];
  activeIndex: number;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSelect: (match: WebSkillSlashMatch) => void;
}

export function WebAgentSkillSlashMenu({
  open,
  anchorRect,
  matches,
  activeIndex,
  loading = false,
  error = null,
  onClose,
  onSelect,
}: WebAgentSkillSlashMenuProps) {
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [visible, setVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && anchorRect) {
      setPhase('in');
      setVisible(true);
      return;
    }
    if (visible) {
      setPhase('out');
    }
  }, [anchorRect, open, visible]);

  useLayoutEffect(() => {
    if (!visible || !anchorRect || !menuRef.current) {
      return;
    }
    const menu = menuRef.current;
    const width = Math.min(360, Math.max(240, anchorRect.width));
    const left = Math.max(12, Math.min(anchorRect.left, window.innerWidth - width - 12));
    const bottom = Math.max(12, window.innerHeight - anchorRect.top + 8);
    menu.style.left = `${left}px`;
    menu.style.bottom = `${bottom}px`;
    menu.style.width = `${width}px`;
  }, [activeIndex, anchorRect, matches.length, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      onClose();
    };
    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', onPointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [onClose, visible]);

  if (!visible || !anchorRect) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu agent-view__composer-mention-menu overlay-popup--${phase}`}
      role='listbox'
      aria-label='Skills'
      style={{ zIndex: 10000 }}
      onAnimationEnd={() => {
        if (phase === 'out') {
          setVisible(false);
        }
      }}
    >
      {loading && matches.length === 0 ? (
        <div className='agent-view__composer-mention-empty'>Carregando skills…</div>
      ) : null}
      {!loading && matches.length === 0 ? (
        <div className='agent-view__composer-mention-empty agent-view__composer-mention-empty--icon'>
          <BookOpen size={16} strokeWidth={2} aria-hidden='true' />
          <span>{error ? 'Mac offline ou runtime parado' : 'Nenhuma skill'}</span>
        </div>
      ) : null}
      {matches.map((match, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={match.id}
            type='button'
            role='option'
            aria-selected={isActive}
            className={`context-menu__item app-button${
              isActive ? ' context-menu__item--active' : ''
            }`}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(match);
              onClose();
            }}
          >
            <BookOpen size={14} strokeWidth={2} aria-hidden='true' />
            <span className='agent-view__composer-mention-label'>{match.label}</span>
            <span className='agent-view__composer-mention-subtitle'>Skill</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
