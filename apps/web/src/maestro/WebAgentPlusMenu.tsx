import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Bug,
  Check,
  ChevronRight,
  FileText,
  Hexagon,
  Image,
  Layers,
  ListTodo,
  MessageCircleQuestion,
  Plus,
} from 'lucide-react';

export type WebAgentMode = 'agent' | 'plan' | 'debug' | 'multitask' | 'ask';

interface ModeOption {
  id: WebAgentMode;
  label: string;
  color: string;
  icon: typeof ListTodo;
}

const MODE_OPTIONS: ModeOption[] = [
  { id: 'plan', label: 'Plan', color: '#22c55e', icon: ListTodo },
  { id: 'debug', label: 'Debug', color: '#f97316', icon: Bug },
  { id: 'multitask', label: 'Multitask', color: '#a855f7', icon: Layers },
  { id: 'ask', label: 'Ask', color: '#06b6d4', icon: MessageCircleQuestion },
];

interface ModelOption {
  value: string;
  label: string;
}

interface WebAgentPlusMenuProps {
  mode: WebAgentMode;
  modelId: string;
  models: ModelOption[];
  onModeChange: (mode: WebAgentMode) => void;
  onModelChange: (modelId: string) => void;
}

export function WebAgentPlusMenu({
  mode,
  modelId,
  models,
  onModeChange,
  onModelChange,
}: WebAgentPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const [query, setQuery] = useState('');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredModes = useMemo(
    () =>
      MODE_OPTIONS.filter((item) =>
        normalizedQuery ? item.label.toLowerCase().includes(normalizedQuery) : true,
      ),
    [normalizedQuery],
  );

  const filteredModels = useMemo(
    () =>
      models.filter((item) =>
        normalizedQuery ? item.label.toLowerCase().includes(normalizedQuery) : true,
      ),
    [models, normalizedQuery],
  );

  const close = useCallback(() => {
    setPhase('out');
  }, []);

  const openMenu = useCallback(() => {
    const next = triggerRef.current?.getBoundingClientRect() ?? null;
    setRect(next);
    setQuery('');
    setModelsOpen(false);
    setPhase('in');
    setOpen(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !rect) {
      return;
    }
    const update = () => {
      const next = triggerRef.current?.getBoundingClientRect() ?? null;
      setRect(next);
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

  const menu =
    open && rect
      ? createPortal(
          <div
            ref={menuRef}
            className={`context-menu agent-view__composer-plus-menu overlay-popup--${phase}`}
            role='menu'
            style={{
              left: Math.max(12, Math.min(rect.left, window.innerWidth - 280)),
              bottom: window.innerHeight - rect.top + 6,
              zIndex: 10000,
            }}
            onAnimationEnd={() => {
              if (phase === 'out') {
                setOpen(false);
              }
            }}
          >
            <label className='agent-view__composer-plus-search'>
              <input
                type='text'
                className='agent-view__composer-plus-search-input'
                value={query}
                placeholder='Adicionar agentes, contexto, ferramentas...'
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {filteredModes.map((item) => {
              const Icon = item.icon;
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type='button'
                  className={`context-menu__item app-button${
                    active ? ' context-menu__item--active' : ''
                  }`}
                  onClick={() => {
                    onModeChange(item.id);
                    close();
                  }}
                >
                  <span
                    className='web-agent-plus-mode-icon'
                    style={{ background: item.color }}
                    aria-hidden='true'
                  >
                    <Icon size={12} strokeWidth={2.25} />
                  </span>
                  <span className='agent-view__composer-plus-item-label'>{item.label}</span>
                  {active ? <Check size={14} aria-hidden='true' /> : null}
                </button>
              );
            })}
            <div className='context-menu__separator' />
            <button
              type='button'
              className='context-menu__item app-button'
              disabled
              title='Em breve'
            >
              <Image size={14} strokeWidth={2} aria-hidden='true' />
              <span>Imagem</span>
            </button>
            <button
              type='button'
              className='context-menu__item app-button'
              disabled
              title='Em breve'
            >
              <FileText size={14} strokeWidth={2} aria-hidden='true' />
              <span>Arquivo</span>
            </button>
            <div className='web-agent-plus-submenu'>
              <button
                type='button'
                className={`context-menu__item app-button${
                  modelsOpen ? ' context-menu__item--active' : ''
                }`}
                onClick={() => setModelsOpen((current) => !current)}
              >
                <Hexagon size={14} strokeWidth={2} aria-hidden='true' />
                <span className='agent-view__composer-plus-item-label'>Modelos</span>
                <ChevronRight size={14} aria-hidden='true' />
              </button>
              {modelsOpen ? (
                <div className='web-agent-plus-submenu__panel'>
                  {filteredModels.map((item) => {
                    const active = item.value === modelId;
                    return (
                      <button
                        key={item.value}
                        type='button'
                        className={`context-menu__item app-button${
                          active ? ' context-menu__item--active' : ''
                        }`}
                        onClick={() => {
                          onModelChange(item.value);
                          close();
                        }}
                      >
                        <span className='agent-view__composer-plus-item-label'>{item.label}</span>
                        {active ? <Check size={14} aria-hidden='true' /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button
              type='button'
              className='context-menu__item app-button'
              disabled
              title='Em breve'
            >
              <BookOpen size={14} strokeWidth={2} aria-hidden='true' />
              <span className='agent-view__composer-plus-item-label'>Skills</span>
              <ChevronRight size={14} aria-hidden='true' />
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className={`agent-view__composer-add app-button app-button--enter${
          open ? ' agent-view__composer-add--open' : ''
        }`}
        aria-label='Adicionar agentes, contexto, ferramentas'
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={() => {
          if (open) {
            close();
            return;
          }
          openMenu();
        }}
      >
        <Plus size={16} strokeWidth={2} aria-hidden='true' />
      </button>
      {menu}
    </>
  );
}
