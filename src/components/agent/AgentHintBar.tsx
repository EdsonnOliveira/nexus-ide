import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Hexagon,
  Image,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import { AgentHintLeading } from '@/components/agent/AgentHintLeading';
import {
  ASK_AI_PROVIDER_OPTIONS,
  cliAgentToAiProvider,
  type AiProviderId,
} from '@/constants/aiProviders';
import {
  positionContextSubmenuWithinViewport,
  positionDropdownAboveAnchor,
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { TerminalCommandHint } from '@/types';
import { shouldShowAgentSkillHints } from '@/utils/parseAgentModeCommand';
import {
  resolveModelBadgeColor,
  resolveModelBadgeIcon,
  type AgentHintBadgeIcon,
} from '@/utils/agentHintBadges';
import { resolveAgentTabCli } from '@/utils/agentTabHelpers';
import { findPaneTab } from '@/utils/tabGroups';

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

function providerBadgeIcon(
  provider: ReturnType<typeof cliAgentToAiProvider>,
): AgentHintBadgeIcon {
  if (provider === 'claude') {
    return 'claude';
  }

  if (provider === 'antigravity') {
    return 'antigravity';
  }

  if (provider === 'opencode') {
    return 'opencode';
  }

  if (provider === 'codex') {
    return 'codex';
  }

  return 'cursor';
}

function providerBadgeLetter(badgeIcon: AgentHintBadgeIcon): string {
  if (badgeIcon === 'claude') {
    return 'A';
  }

  if (badgeIcon === 'opencode') {
    return 'O';
  }

  if (badgeIcon === 'antigravity') {
    return 'G';
  }

  if (badgeIcon === 'codex') {
    return 'X';
  }

  return 'C';
}

function usePaneCliAgent(paneId: string, fallbackCli?: string): string {
  const activeAgent = useTerminalSessionStore((state) => state.activeAgentByPane[paneId]);
  const tabCli = useProjectStore((state) => {
    for (const project of state.projects) {
      const pane = findPaneTab(project.tabs, paneId);
      if (pane?.type === 'agent') {
        return resolveAgentTabCli(pane);
      }
    }
    return null;
  });

  return activeAgent?.trim() || tabCli || fallbackCli?.trim() || 'cursor-agent';
}

function buildAiProviderHints(): TerminalCommandHint[] {
  return ASK_AI_PROVIDER_OPTIONS.map((option) => {
    const badgeIcon = providerBadgeIcon(option.id);

    return {
      id: `ai-${option.id}`,
      badge: providerBadgeLetter(badgeIcon),
      badgeIcon,
      badgeColor: resolveModelBadgeColor(badgeIcon),
      label: option.label,
      command: `/ai ${option.id}\n`,
      hintKind: 'model' as const,
    };
  });
}

function useAgentHints(paneId: string, cwd: string, isVisible: boolean, fallbackCli?: string) {
  const [hints, setHints] = useState<TerminalCommandHint[]>([]);
  const activeAgentMode = useTerminalSessionStore(
    (state) => state.activeAgentModeByPane[paneId] ?? 'agent',
  );
  const showSkillHints = shouldShowAgentSkillHints(activeAgentMode);
  const paneCliAgent = usePaneCliAgent(paneId, fallbackCli);
  const aiProvider = cliAgentToAiProvider(paneCliAgent);

  useEffect(() => {
    if (!isVisible || !window.nexus?.files) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const footerHints = cwd
        ? await window.nexus.files.getAgentSkillHints(cwd)
        : [];

      if (cancelled) {
        return;
      }

      let modelHints = footerHints.filter((hint) => hint.hintKind === 'model');

      if (aiProvider !== 'cursor' && window.nexus.files.getAgentModels) {
        const models = await window.nexus.files.getAgentModels(aiProvider);

        if (cancelled) {
          return;
        }

        const badgeIcon = providerBadgeIcon(aiProvider);
        modelHints = models.map((model) => ({
          id: `model-${model.id}`,
          badge: providerBadgeLetter(badgeIcon),
          badgeIcon,
          badgeColor: resolveModelBadgeColor(badgeIcon),
          label: model.label,
          command: `/model ${model.id}\n`,
          hintKind: 'model' as const,
        }));
      }

      setHints([
        ...footerHints.filter((hint) => hint.hintKind !== 'model'),
        ...modelHints,
      ]);
    })();

    return () => {
      cancelled = true;
    };
  }, [aiProvider, cwd, isVisible, paneId]);

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
  cliAgent?: string;
  onRunCommand: (command: string) => void;
  onSelectSkill?: (hint: TerminalCommandHint) => void;
  onAttachImage: () => void;
  onAttachFile: () => void;
  onRemoveAgent?: () => void;
  onRequestComposerFocus?: () => void;
  removeAgentLabel?: string;
  triggerVariant?: 'plus' | 'more';
  triggerClassName?: string;
  ariaLabel?: string;
  menuPlacement?: 'above' | 'below';
  menuAlign?: 'start' | 'end';
}

function AgentComposerPlusMenuComponent({
  paneId,
  cwd,
  isVisible,
  cliAgent,
  onRunCommand,
  onSelectSkill,
  onAttachImage,
  onAttachFile,
  onRemoveAgent,
  onRequestComposerFocus,
  removeAgentLabel = 'Remover agent',
  triggerVariant = 'plus',
  triggerClassName,
  ariaLabel = 'Adicionar contexto',
  menuPlacement = 'above',
  menuAlign = 'start',
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
    cliAgent,
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
    window.requestAnimationFrame(() => {
      onRequestComposerFocus?.();
    });
  }, [onRequestComposerFocus]);

  const handleSelect = useCallback(
    (hint: TerminalCommandHint) => {
      if (hint.hintKind === 'skill') {
        if (onSelectSkill) {
          onSelectSkill(hint);
        } else {
          onRunCommand(hint.command);
        }

        handleClose();
        return;
      }

      onRunCommand(hint.command);
      handleClose();
    },
    [handleClose, onRunCommand, onSelectSkill],
  );

  const handleAttachImage = useCallback(() => {
    onAttachImage();
    handleClose();
  }, [handleClose, onAttachImage]);

  const handleAttachFile = useCallback(() => {
    onAttachFile();
    handleClose();
  }, [handleClose, onAttachFile]);

  const handleRemoveAgent = useCallback(() => {
    onRemoveAgent?.();
    handleClose();
  }, [handleClose, onRemoveAgent]);

  const triggerClasses = [
    triggerVariant === 'more' ? 'agent-view__composer-more' : 'agent-view__composer-add',
    'app-button',
    'app-button--enter',
    open ? (triggerVariant === 'more' ? 'agent-view__composer-more--open' : 'agent-view__composer-add--open') : '',
    triggerClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const triggerIcon =
    triggerVariant === 'more' ? (
      <MoreHorizontal size={16} strokeWidth={2} />
    ) : (
      <Plus size={16} strokeWidth={2} />
    );

  if (!isVisible) {
    return (
      <button type='button' className={triggerClasses} aria-label={ariaLabel} disabled>
        {triggerIcon}
      </button>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className={triggerClasses}
        aria-label={ariaLabel}
        aria-haspopup='menu'
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleToggle}
      >
        {triggerIcon}
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
              menuPlacement={menuPlacement}
              menuAlign={menuAlign}
              onClose={handleClose}
              onSelect={handleSelect}
              onAttachImage={handleAttachImage}
              onAttachFile={handleAttachFile}
              onRemoveAgent={onRemoveAgent ? handleRemoveAgent : undefined}
              removeAgentLabel={removeAgentLabel}
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
  menuPlacement: 'above' | 'below';
  menuAlign: 'start' | 'end';
  onClose: () => void;
  onSelect: (hint: TerminalCommandHint) => void;
  onAttachImage: () => void;
  onAttachFile: () => void;
  onRemoveAgent?: () => void;
  removeAgentLabel: string;
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
  menuPlacement,
  menuAlign,
  onClose,
  onSelect,
  onAttachImage,
  onAttachFile,
  onRemoveAgent,
  removeAgentLabel,
}: AgentComposerPlusMenuPanelProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) =>
      menuPlacement === 'below'
        ? positionDropdownBelowAnchor(menu, anchorRect, menuAlign)
        : positionDropdownAboveAnchor(menu, anchorRect, menuAlign),
    [anchorRect, menuAlign, menuPlacement],
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
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={() => onSelect(hint)}
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
      <button type='button' className='context-menu__item app-button' onClick={onAttachFile}>
        <FileText size={14} strokeWidth={2} aria-hidden='true' />
        <span>Arquivo</span>
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
      {onRemoveAgent &&
      (!query.trim() ||
        removeAgentLabel.toLowerCase().includes(query.trim().toLowerCase())) ? (
        <>
          <div className='context-menu__separator' />
          <button
            type='button'
            className='context-menu__item context-menu__item--danger app-button'
            onClick={onRemoveAgent}
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden='true' />
            <span>{removeAgentLabel}</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

const AgentComposerPlusMenuPanel = memo(AgentComposerPlusMenuPanelComponent);

export const AgentComposerPlusMenu = memo(AgentComposerPlusMenuComponent);

interface AgentComposerModelSelectProps {
  paneId: string;
  cwd: string;
  isVisible: boolean;
  cliAgent?: string;
  onRunCommand: (command: string) => void;
  onRequestComposerFocus?: () => void;
}

const AI_PROVIDER_HINTS = buildAiProviderHints();

function AgentComposerModelSelectComponent({
  paneId,
  cwd,
  isVisible,
  cliAgent,
  onRunCommand,
  onRequestComposerFocus,
}: AgentComposerModelSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('Auto');
  const [selectedHintId, setSelectedHintId] = useState<string | null>(null);
  const { modelHints } = useAgentHints(paneId, cwd, isVisible, cliAgent);
  const paneCliAgent = usePaneCliAgent(paneId, cliAgent);
  const storedModelId = useTerminalSessionStore((state) => state.agentModelByPane[paneId] ?? null);
  const currentProvider = cliAgentToAiProvider(paneCliAgent);
  const currentProviderHint =
    AI_PROVIDER_HINTS.find((hint) => hint.id === `ai-${currentProvider}`) ?? AI_PROVIDER_HINTS[0]!;
  const currentProviderLabel =
    ASK_AI_PROVIDER_OPTIONS.find((option) => option.id === currentProvider)?.label ?? 'Cursor';

  useEffect(() => {
    if (modelHints.length === 0) {
      return;
    }

    if (storedModelId) {
      const match = modelHints.find((hint) => hint.id.replace(/^model-/, '') === storedModelId);

      if (match) {
        const label = shortenMenuLabel(match.label);

        if (selectedHintId !== match.id || selectedLabel !== label) {
          setSelectedLabel(label);
          setSelectedHintId(match.id);
        }

        return;
      }
    }

    const stillValid = modelHints.some(
      (hint) =>
        hint.id === selectedHintId || shortenMenuLabel(hint.label) === selectedLabel,
    );

    if (stillValid) {
      return;
    }

    const next = modelHints[0];
    if (!next) {
      return;
    }

    setSelectedLabel(shortenMenuLabel(next.label));
    setSelectedHintId(next.id);
  }, [modelHints, selectedHintId, selectedLabel, storedModelId]);

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
    window.requestAnimationFrame(() => {
      onRequestComposerFocus?.();
    });
  }, [onRequestComposerFocus]);

  const handleSelect = useCallback(
    (hint: TerminalCommandHint) => {
      if (hint.id.startsWith('ai-')) {
        const providerId = hint.id.slice(3) as Exclude<AiProviderId, 'nexus'>;

        if (providerId !== currentProvider) {
          setSelectedHintId(null);
          setSelectedLabel('Auto');
          onRunCommand(hint.command);
        }

        handleClose();
        return;
      }

      setSelectedLabel(shortenMenuLabel(hint.label));
      setSelectedHintId(hint.id);
      onRunCommand(hint.command);
      handleClose();
    },
    [currentProvider, handleClose, onRunCommand],
  );

  if (!isVisible) {
    return null;
  }

  const triggerHint = selectedHint ?? currentProviderHint;
  const triggerLabel = selectedHint ? selectedLabel : currentProviderLabel;

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className='agent-view__composer-select app-button app-button--enter'
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label={`IA ${currentProviderLabel}, modelo ${triggerLabel}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleOpen}
      >
        {triggerHint ? <AgentHintLeading hint={triggerHint} /> : null}
        <span className='agent-view__composer-select-label'>{triggerLabel}</span>
        <ChevronDown size={14} className='agent-view__composer-select-chevron' aria-hidden='true' />
      </button>
      {open && anchorRect
        ? createPortal(
            <AgentComposerModelMenuPanel
              anchorRect={anchorRect}
              triggerRef={triggerRef}
              providerHints={AI_PROVIDER_HINTS}
              currentProvider={currentProvider}
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
  providerHints: TerminalCommandHint[];
  currentProvider: Exclude<AiProviderId, 'nexus'>;
  modelHints: TerminalCommandHint[];
  selectedLabel: string;
  onClose: () => void;
  onSelect: (hint: TerminalCommandHint) => void;
}

function AgentComposerModelMenuPanelComponent({
  anchorRect,
  triggerRef,
  providerHints,
  currentProvider,
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
      aria-label='IA e modelo'
    >
      <div className='agent-view__composer-menu-heading'>IA</div>
      {providerHints.map((hint) => {
        const isActive = hint.id === `ai-${currentProvider}`;

        return (
          <button
            key={hint.id}
            type='button'
            className={`context-menu__item app-button app-button--enter${isActive ? ' context-menu__item--active' : ''}`}
            onClick={() => onSelect(hint)}
          >
            <AgentHintLeading hint={hint} />
            <span className='agent-view__composer-plus-item-label'>{hint.label}</span>
            {isActive ? <Check size={14} aria-hidden='true' /> : null}
          </button>
        );
      })}
      {modelHints.length > 0 ? (
        <>
          <div className='context-menu__separator' />
          <div className='agent-view__composer-menu-heading'>Modelo</div>
          {modelHints.map((hint) => {
            const label = shortenMenuLabel(hint.label);
            const isActive = label === selectedLabel;

            return (
              <button
                key={hint.id}
                type='button'
                className={`context-menu__item app-button app-button--enter${isActive ? ' context-menu__item--active' : ''}`}
                onClick={() => onSelect(hint)}
              >
                <AgentHintLeading hint={hint} />
                <span className='agent-view__composer-plus-item-label'>{label}</span>
                {isActive ? <Check size={14} aria-hidden='true' /> : null}
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

const AgentComposerModelMenuPanel = memo(AgentComposerModelMenuPanelComponent);

export const AgentComposerModelSelect = memo(AgentComposerModelSelectComponent);

export function useAgentModelHints(
  paneId: string,
  cwd: string,
  isVisible: boolean,
  fallbackCli?: string,
) {
  const { modelHints } = useAgentHints(paneId, cwd, isVisible, fallbackCli);

  return modelHints;
}
