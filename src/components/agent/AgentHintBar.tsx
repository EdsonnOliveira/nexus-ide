import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, ChevronDown, ChevronRight, Hexagon, Image, Plus } from 'lucide-react';
import { AgentHintLeading } from '@/components/agent/AgentHintLeading';
import {
  positionContextSubmenuWithinViewport,
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { TerminalCommandHint } from '@/types';
import { shouldShowAgentSkillHints } from '@/utils/parseAgentModeCommand';
import {
  resolveModelBadgeColor,
  resolveModelBadgeIcon,
} from '@/utils/agentHintBadges';

type PlusSubmenu = 'models' | 'skills' | null;

function shortenMenuLabel(label: string): string {
  return label
    .replace(/\s*\(default\)\s*$/i, '')
    .replace(/\s*\(NO ZDR\)\s*$/i, '')
    .trim();
}

function enrichModelHint(hint: TerminalCommandHint): TerminalCommandHint {
  if (hint.hintKind !== 'model' || hint.badgeIcon) {
    return hint;
  }

  const modelId = hint.id.replace(/^model-/, '');
  const badgeIcon = resolveModelBadgeIcon(modelId, hint.label);

  return {
    ...hint,
    badgeIcon,
    badgeColor: hint.badgeColor ?? resolveModelBadgeColor(badgeIcon),
  };
}

function useAgentHints(paneId: string, cwd: string, isVisible: boolean) {
  const [hints, setHints] = useState<TerminalCommandHint[]>([]);
  const activeAgentMode = useTerminalSessionStore(
    (state) => state.activeAgentModeByPane[paneId] ?? 'agent',
  );
  const showSkillHints = shouldShowAgentSkillHints(activeAgentMode);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let cancelled = false;

    void window.nexus.files.getAgentSkillHints(cwd).then((entries) => {
      if (!cancelled) {
        setHints(entries);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cwd, isVisible, paneId]);

  return useMemo(() => {
    const filtered = showSkillHints
      ? hints
      : hints.filter((hint) => hint.hintKind !== 'skill');

    const modeHints = filtered.filter((hint) => hint.hintKind === 'mode');
    const modelHints = filtered.filter((hint) => hint.hintKind === 'model').map(enrichModelHint);
    const skillHints = filtered.filter((hint) => hint.hintKind === 'skill');

    return {
      modeHints,
      plusModeHints: modeHints.filter((hint) => hint.id !== 'mode-agent'),
      modelHints,
      skillHints,
      activeAgentMode,
      showSkillHints,
    };
  }, [activeAgentMode, hints, showSkillHints]);
}

interface AgentComposerPlusMenuProps {
  paneId: string;
  cwd: string;
  isVisible: boolean;
  onRunCommand: (command: string) => void;
  onAttachImage: () => void;
}

function AgentComposerPlusMenuComponent({
  paneId,
  cwd,
  isVisible,
  onRunCommand,
  onAttachImage,
}: AgentComposerPlusMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const [openSubmenu, setOpenSubmenu] = useState<PlusSubmenu>(null);
  const { plusModeHints, modelHints, skillHints, activeAgentMode, showSkillHints } = useAgentHints(
    paneId,
    cwd,
    isVisible,
  );

  const normalizedQuery = query.trim().toLowerCase();

  const filteredPlusModes = useMemo(() => {
    if (!normalizedQuery) {
      return plusModeHints;
    }

    return plusModeHints.filter((hint) => hint.label.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, plusModeHints]);

  const filteredModels = useMemo(() => {
    if (!normalizedQuery) {
      return modelHints;
    }

    return modelHints.filter((hint) => hint.label.toLowerCase().includes(normalizedQuery));
  }, [modelHints, normalizedQuery]);

  const filteredSkills = useMemo(() => {
    if (!normalizedQuery) {
      return skillHints;
    }

    return skillHints.filter((hint) => hint.label.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, skillHints]);

  const handleToggle = useCallback(() => {
    if (open) {
      setOpen(false);
      setOpenSubmenu(null);
      setQuery('');
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAnchorRect(rect);
    setOpen(true);
  }, [open]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setOpenSubmenu(null);
    setQuery('');
  }, []);

  const handleSelect = useCallback(
    (command: string) => {
      onRunCommand(command);
      handleClose();
    },
    [handleClose, onRunCommand],
  );

  const handleAttach = useCallback(() => {
    onAttachImage();
    handleClose();
  }, [handleClose, onAttachImage]);

  if (!isVisible) {
    return (
      <button
        type='button'
        className='agent-view__composer-add app-button app-button--enter'
        aria-label='Adicionar contexto'
        disabled
      >
        <Plus size={16} strokeWidth={2} />
      </button>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className={`agent-view__composer-add app-button app-button--enter${open ? ' agent-view__composer-add--open' : ''}`}
        aria-label='Adicionar contexto'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={handleToggle}
      >
        <Plus size={16} strokeWidth={2} />
      </button>
      {open && anchorRect
        ? createPortal(
            <AgentComposerPlusMenuPanel
              anchorRect={anchorRect}
              triggerRef={triggerRef}
              query={query}
              onQueryChange={setQuery}
              openSubmenu={openSubmenu}
              onOpenSubmenuChange={setOpenSubmenu}
              plusModeHints={filteredPlusModes}
              modelHints={filteredModels}
              skillHints={showSkillHints ? filteredSkills : []}
              activeAgentMode={activeAgentMode}
              onClose={handleClose}
              onSelect={handleSelect}
              onAttachImage={handleAttach}
            />,
            document.body,
          )
        : null}
    </>
  );
}

interface AgentComposerSubmenuRowProps {
  kind: PlusSubmenu;
  openSubmenu: PlusSubmenu;
  onOpenSubmenuChange: (value: PlusSubmenu) => void;
  label: string;
  icon: React.ReactNode;
  items: TerminalCommandHint[];
  renderHintItem: (hint: TerminalCommandHint, isActive: boolean) => ReactNode;
}

function AgentComposerSubmenuRowComponent({
  kind,
  openSubmenu,
  onOpenSubmenuChange,
  label,
  icon,
  items,
  renderHintItem,
}: AgentComposerSubmenuRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const isOpen = openSubmenu === kind;

  const repositionSubmenu = useCallback(() => {
    if (!isOpen || !rowRef.current) {
      return;
    }

    const submenu = rowRef.current.querySelector('.context-menu__submenu');

    if (submenu instanceof HTMLDivElement) {
      positionContextSubmenuWithinViewport(submenu, rowRef.current);
    }
  }, [isOpen, items]);

  useLayoutEffect(() => {
    repositionSubmenu();
  }, [repositionSubmenu]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    window.addEventListener('resize', repositionSubmenu);

    return () => {
      window.removeEventListener('resize', repositionSubmenu);
    };
  }, [isOpen, repositionSubmenu]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={rowRef}
      className={`context-menu__submenu-row${isOpen ? ' context-menu__submenu-row--open' : ''}`}
      onMouseEnter={() => onOpenSubmenuChange(kind)}
      onMouseLeave={() => onOpenSubmenuChange(null)}
    >
      <button
        type='button'
        className='context-menu__item context-menu__item--submenu app-button'
        aria-haspopup='menu'
        aria-expanded={isOpen}
      >
        {icon}
        <span>{label}</span>
        <ChevronRight size={14} strokeWidth={2} className='context-menu__submenu-chevron' aria-hidden />
      </button>
      {isOpen ? (
        <>
          <div
            className='context-menu__submenu-bridge'
            aria-hidden='true'
            onMouseEnter={() => onOpenSubmenuChange(kind)}
          />
          <div className='context-menu context-menu__submenu overlay-popup--in' role='menu'>
            {items.map((hint) => renderHintItem(hint, false))}
          </div>
        </>
      ) : null}
    </div>
  );
}

const AgentComposerSubmenuRow = memo(AgentComposerSubmenuRowComponent);

interface AgentComposerPlusMenuPanelProps {
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  openSubmenu: PlusSubmenu;
  onOpenSubmenuChange: (value: PlusSubmenu) => void;
  plusModeHints: TerminalCommandHint[];
  modelHints: TerminalCommandHint[];
  skillHints: TerminalCommandHint[];
  activeAgentMode: string;
  onClose: () => void;
  onSelect: (command: string) => void;
  onAttachImage: () => void;
}

function AgentComposerPlusMenuPanelComponent({
  anchorRect,
  triggerRef,
  query,
  onQueryChange,
  openSubmenu,
  onOpenSubmenuChange,
  plusModeHints,
  modelHints,
  skillHints,
  activeAgentMode,
  onClose,
  onSelect,
  onAttachImage,
}: AgentComposerPlusMenuPanelProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
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
  }, [menuRef, requestClose, triggerRef]);

  const renderHintItem = (hint: TerminalCommandHint, isActive: boolean) => {
    const isMode =
      hint.hintKind === 'mode' ||
      (hint.badgeIcon?.startsWith('mode-') && hint.badgeIcon !== 'mode-agent');

    return (
      <button
        key={hint.id}
        type='button'
        className={`context-menu__item app-button${isMode ? ' agent-view__composer-plus-item--mode' : ''}${isActive ? ' context-menu__item--active' : ''}`}
        onClick={() => onSelect(hint.command)}
      >
        <AgentHintLeading hint={hint} />
        <span className='agent-view__composer-plus-item-label'>{shortenMenuLabel(hint.label)}</span>
        {isActive ? <Check size={14} aria-hidden='true' /> : null}
      </button>
    );
  };

  return (
    <div
      ref={menuRef}
      className={`context-menu agent-view__composer-plus-menu overlay-popup ${animationClass}`}
      role='menu'
    >
      <label className='agent-view__composer-plus-search'>
        <input
          type='text'
          className='agent-view__composer-plus-search-input'
          value={query}
          placeholder='Adicionar agentes, contexto, ferramentas...'
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      {plusModeHints.map((hint) => renderHintItem(hint, hint.id.includes(`mode-${activeAgentMode}`)))}
      <div className='context-menu__separator' />
      <button type='button' className='context-menu__item app-button' onClick={onAttachImage}>
        <Image size={14} strokeWidth={2} aria-hidden='true' />
        <span>Imagem</span>
      </button>
      <AgentComposerSubmenuRow
        kind='models'
        openSubmenu={openSubmenu}
        onOpenSubmenuChange={onOpenSubmenuChange}
        label='Modelos'
        icon={<Hexagon size={14} strokeWidth={2} aria-hidden='true' />}
        items={modelHints}
        renderHintItem={renderHintItem}
      />
      <AgentComposerSubmenuRow
        kind='skills'
        openSubmenu={openSubmenu}
        onOpenSubmenuChange={onOpenSubmenuChange}
        label='Skills'
        icon={<BookOpen size={14} strokeWidth={2} aria-hidden='true' />}
        items={skillHints}
        renderHintItem={renderHintItem}
      />
    </div>
  );
}

const AgentComposerPlusMenuPanel = memo(AgentComposerPlusMenuPanelComponent);

export const AgentComposerPlusMenu = memo(AgentComposerPlusMenuComponent);

interface AgentComposerModelSelectProps {
  paneId: string;
  cwd: string;
  isVisible: boolean;
  onRunCommand: (command: string) => void;
}

function AgentComposerModelSelectComponent({
  paneId,
  cwd,
  isVisible,
  onRunCommand,
}: AgentComposerModelSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('Auto');
  const [selectedHintId, setSelectedHintId] = useState<string | null>(null);
  const { modelHints } = useAgentHints(paneId, cwd, isVisible);

  const selectedHint = useMemo(() => {
    if (selectedHintId) {
      const match = modelHints.find((hint) => hint.id === selectedHintId);

      if (match) {
        return match;
      }
    }

    return (
      modelHints.find((hint) => shortenMenuLabel(hint.label) === selectedLabel) ??
      modelHints.find((hint) => hint.id === 'model-auto') ??
      modelHints[0] ??
      null
    );
  }, [modelHints, selectedHintId, selectedLabel]);

  const handleOpen = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAnchorRect(rect);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSelect = useCallback(
    (hint: TerminalCommandHint) => {
      setSelectedLabel(shortenMenuLabel(hint.label));
      setSelectedHintId(hint.id);
      onRunCommand(hint.command);
      handleClose();
    },
    [handleClose, onRunCommand],
  );

  if (!isVisible || modelHints.length === 0) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className='agent-view__composer-select app-button app-button--enter'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={handleOpen}
      >
        {selectedHint ? <AgentHintLeading hint={selectedHint} /> : null}
        <span className='agent-view__composer-select-label'>{selectedLabel}</span>
        <ChevronDown size={14} className='agent-view__composer-select-chevron' aria-hidden='true' />
      </button>
      {open && anchorRect
        ? createPortal(
            <AgentComposerModelMenuPanel
              anchorRect={anchorRect}
              triggerRef={triggerRef}
              modelHints={modelHints}
              selectedLabel={selectedLabel}
              onClose={handleClose}
              onSelect={handleSelect}
            />,
            document.body,
          )
        : null}
    </>
  );
}

interface AgentComposerModelMenuPanelProps {
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  modelHints: TerminalCommandHint[];
  selectedLabel: string;
  onClose: () => void;
  onSelect: (hint: TerminalCommandHint) => void;
}

function AgentComposerModelMenuPanelComponent({
  anchorRect,
  triggerRef,
  modelHints,
  selectedLabel,
  onClose,
  onSelect,
}: AgentComposerModelMenuPanelProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
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
  }, [menuRef, requestClose, triggerRef]);

  return (
    <div
      ref={menuRef}
      className={`context-menu agent-view__composer-menu overlay-popup ${animationClass}`}
      role='menu'
    >
      {modelHints.map((hint) => {
        const label = shortenMenuLabel(hint.label);
        const isActive = label === selectedLabel;

        return (
          <button
            key={hint.id}
            type='button'
            className={`context-menu__item app-button${isActive ? ' context-menu__item--active' : ''}`}
            onClick={() => onSelect(hint)}
          >
            <AgentHintLeading hint={hint} />
            <span className='agent-view__composer-plus-item-label'>{label}</span>
            {isActive ? <Check size={14} aria-hidden='true' /> : null}
          </button>
        );
      })}
    </div>
  );
}

const AgentComposerModelMenuPanel = memo(AgentComposerModelMenuPanelComponent);

export const AgentComposerModelSelect = memo(AgentComposerModelSelectComponent);

export function useAgentModelHints(paneId: string, cwd: string, isVisible: boolean) {
  const { modelHints } = useAgentHints(paneId, cwd, isVisible);

  return modelHints;
}
