import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  AtSign,
  BookOpen,
  Check,
  File,
  FileText,
  FolderKanban,
  Image,
  Paperclip,
  X,
} from 'lucide-react';
import logoAntigravity from '@/assets/logo-antigravity.svg';
import logoClaude from '@/assets/logo-claude.svg';
import logoCodex from '@/assets/logo-codex.svg';
import logoCursor from '@/assets/logo-cursor.svg';
import logoOpencode from '@/assets/logo-opencode.svg';
import { AgentComposerModeChip } from '@/components/agent/AgentComposerModeChip';
import { AgentPromptImageMentionText } from '@/components/agent/AgentPromptImageBadges';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { HomeDashboardViewMode } from '@/components/home/HomeDashboardModeSwitch';
import {
  AGENT_MODE_INPUT_PLACEHOLDERS,
  getAgentModeOption,
  type AutomationAgentMode,
} from '@/constants/agentModes';
import {
  ASK_AI_PROVIDER_OPTIONS,
  type AiProviderId,
} from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import {
  positionDropdownAboveAnchor,
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useAgentComposerMention } from '@/hooks/useAgentComposerMention';
import { useTabActions } from '@/stores/useTabStore';
import type { Project, TerminalCommandHint } from '@/types';
import {
  applyComposerMention,
  type ComposerMentionMatch,
} from '@/utils/agentComposerMention';
import {
  buildAgentComposerMentionsInsertion,
  resolveAgentComposerDropMentions,
  resolveAgentComposerPathMention,
} from '@/utils/agentComposerDrop';
import {
  AGENT_PROMPT_IMAGE_MENTION_REGEX,
  buildAgentPromptImageMention,
  buildAgentPromptImageMentionInsertion,
  getAgentPromptImageBadgeColor,
} from '@/utils/agentPromptImageBadge';
import {
  readDroppedImageDataUrls,
  readImagePathAsDataUrl,
} from '@/utils/attachAgentPromptImage';
import { cycleAgentMode } from '@/utils/cycleAgentMode';
import { executeHomeDashboardAgentPrompt } from '@/utils/executeHomeDashboardAgentPrompt';
import { isExternalFileDrag } from '@/utils/explorerExternalDrop';
import { HOME_ASK_FOCUS_EVENT } from '@/utils/homeDashboardAgents';
import { blobToDataUrl } from '@/utils/terminalClipboardImage';
import { useProjectStore } from '@/stores/useProjectStore';

export interface HomeDashboardPromptFlightStart {
  id: string;
  text: string;
  projectName: string;
  projectColor: string;
  fromRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

interface HomeDashboardAskBarProps {
  projects: Project[];
  viewMode: HomeDashboardViewMode;
  compact?: boolean;
  onAgentOpened?: () => void;
  onPromptFlightStart?: (payload: HomeDashboardPromptFlightStart) => void;
  onPromptFlightLand?: (flightId: string, paneId: string) => void;
  onPromptFlightCancel?: (flightId: string) => void;
}

interface AskProjectThumbProps {
  logo?: string | null;
  icon: string;
  color: string;
}

interface PendingAskImage {
  id: string;
  dataUrl: string;
}

const EMPTY_SKILL_HINTS: TerminalCommandHint[] = [];

interface AskAttachMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onAttachImage: () => void;
  onAttachFile: () => void;
}

interface AskAiProviderMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
  value: Exclude<AiProviderId, 'nexus'>;
  onClose: () => void;
  onSelect: (provider: Exclude<AiProviderId, 'nexus'>) => void;
}

const ASK_AI_PROVIDER_LOGOS: Record<Exclude<AiProviderId, 'nexus'>, string> = {
  cursor: logoCursor,
  claude: logoClaude,
  codex: logoCodex,
  opencode: logoOpencode,
  antigravity: logoAntigravity,
};

function AskAiProviderLogoComponent({ provider }: { provider: Exclude<AiProviderId, 'nexus'> }) {
  return (
    <i className='home-dashboard__ask-ai-logo-wrap' aria-hidden='true'>
      <img
        src={ASK_AI_PROVIDER_LOGOS[provider]}
        alt=''
        className='home-dashboard__ask-ai-logo'
        draggable={false}
      />
    </i>
  );
}

const AskAiProviderLogo = memo(AskAiProviderLogoComponent);

interface AskMentionMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  matches: ComposerMentionMatch[];
  activeIndex: number;
  isLoading: boolean;
  trigger: '@' | '/';
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (match: ComposerMentionMatch) => void;
}

function resizeAskInput(textarea: HTMLTextAreaElement): void {
  const styles = window.getComputedStyle(textarea);
  const minHeight = Number.parseFloat(styles.minHeight);
  const maxHeight = Number.parseFloat(styles.maxHeight);
  const minPx = Number.isFinite(minHeight) && minHeight > 0 ? minHeight : 40;
  const maxPx = Number.isFinite(maxHeight) && maxHeight > 0 ? maxHeight : 96;

  if (!textarea.value) {
    textarea.style.height = `${minPx}px`;
    textarea.style.overflowY = 'hidden';
    return;
  }

  textarea.style.overflowY = 'hidden';
  textarea.style.height = '0px';
  void textarea.offsetHeight;
  const contentHeight = textarea.scrollHeight;
  const nextHeight = Math.min(maxPx, Math.max(minPx, contentHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > nextHeight ? 'auto' : 'hidden';
}

function AskProjectThumbComponent({ logo, icon, color }: AskProjectThumbProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(logo).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [logo]);

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  if (logoSrc && !logoFailed) {
    return (
      <img
        key={logo}
        src={logoSrc}
        alt=''
        className='home-dashboard__ask-project-logo'
        onError={handleLogoError}
      />
    );
  }

  return (
    <span className='home-dashboard__ask-project-icon' style={{ background: color }}>
      <ProjectIconMark icon={icon} size={12} />
    </span>
  );
}

const AskProjectThumb = memo(AskProjectThumbComponent);

function AskAttachMenuPanelComponent({
  anchorRect,
  triggerRef,
  onClose,
  onAttachImage,
  onAttachFile,
}: Omit<AskAttachMenuProps, 'open'>) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => {
      positionDropdownBelowAnchor(menu, anchorRect!, 'end');
    },
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

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown, true);
    }, 0);

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, requestClose, triggerRef]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup overlay-popup--anchor-end ${animationClass}`}
      role='menu'
    >
      <button
        type='button'
        className='context-menu__item app-button app-button--enter'
        role='menuitem'
        onClick={() => {
          onAttachImage();
          requestClose();
        }}
      >
        <Image size={14} strokeWidth={2} aria-hidden='true' />
        <span>Imagem</span>
      </button>
      <button
        type='button'
        className='context-menu__item app-button app-button--enter'
        role='menuitem'
        onClick={() => {
          onAttachFile();
          requestClose();
        }}
      >
        <FileText size={14} strokeWidth={2} aria-hidden='true' />
        <span>Arquivo</span>
      </button>
    </div>,
    document.body,
  );
}

const AskAttachMenuPanel = memo(AskAttachMenuPanelComponent);

function AskAttachMenuComponent({
  open,
  anchorRect,
  triggerRef,
  onClose,
  onAttachImage,
  onAttachFile,
}: AskAttachMenuProps) {
  if (!open || !anchorRect) {
    return null;
  }

  return (
    <AskAttachMenuPanel
      anchorRect={anchorRect}
      triggerRef={triggerRef}
      onClose={onClose}
      onAttachImage={onAttachImage}
      onAttachFile={onAttachFile}
    />
  );
}

const AskAttachMenu = memo(AskAttachMenuComponent);

function AskAiProviderMenuPanelComponent({
  anchorRect,
  triggerRef,
  value,
  onClose,
  onSelect,
}: Omit<AskAiProviderMenuProps, 'open'>) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => {
      positionDropdownBelowAnchor(menu, anchorRect!, 'end');
    },
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

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown, true);
    }, 0);

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, requestClose, triggerRef]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup overlay-popup--anchor-end ${animationClass}`}
      role='menu'
      aria-label='IA deste agent'
    >
      {ASK_AI_PROVIDER_OPTIONS.map((option) => {
        const isActive = option.id === value;

        return (
          <button
            key={option.id}
            type='button'
            className={`context-menu__item app-button app-button--enter${
              isActive ? ' context-menu__item--active' : ''
            }`}
            role='menuitem'
            onClick={() => {
              onSelect(option.id);
              requestClose();
            }}
          >
            <AskAiProviderLogo provider={option.id} />
            <span>{option.label}</span>
            {isActive ? <Check size={14} strokeWidth={2} aria-hidden='true' /> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

const AskAiProviderMenuPanel = memo(AskAiProviderMenuPanelComponent);

function AskAiProviderMenuComponent({
  open,
  anchorRect,
  triggerRef,
  value,
  onClose,
  onSelect,
}: AskAiProviderMenuProps) {
  if (!open || !anchorRect) {
    return null;
  }

  return (
    <AskAiProviderMenuPanel
      anchorRect={anchorRect}
      triggerRef={triggerRef}
      value={value}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}

const AskAiProviderMenu = memo(AskAiProviderMenuComponent);

function AskMentionMenuPanelComponent({
  anchorRect,
  matches,
  activeIndex,
  isLoading,
  trigger,
  triggerRef,
  onClose,
  onSelect,
}: Omit<AskMentionMenuProps, 'open'>) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => {
      positionDropdownAboveAnchor(menu, anchorRect!, 'end');
    },
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
      window.addEventListener('mousedown', handlePointerDown, true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [menuRef, requestClose, triggerRef]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu agent-view__composer-mention-menu overlay-popup overlay-popup--anchor-end ${animationClass}`}
      role='listbox'
      aria-label='Menções'
    >
      {isLoading && matches.length === 0 ? (
        <div className='agent-view__composer-mention-empty'>Buscando…</div>
      ) : null}
      {!isLoading && matches.length === 0 ? (
        <EmptyState
          icon={trigger === '/' ? BookOpen : File}
          message={trigger === '/' ? 'Nenhuma skill' : 'Nenhum resultado'}
          compact
        />
      ) : null}
      {matches.map((match, index) => {
        const isActive = index === activeIndex;
        const MatchIcon = match.kind === 'skill' ? BookOpen : match.kind === 'directory' ? FolderKanban : File;

        return (
          <button
            key={match.id}
            type='button'
            role='option'
            aria-selected={isActive}
            className={`context-menu__item app-button${isActive ? ' context-menu__item--active' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(match);
              requestClose();
            }}
          >
            <MatchIcon size={14} strokeWidth={2} aria-hidden='true' />
            <span className='agent-view__composer-mention-label'>{match.label}</span>
            <span className='agent-view__composer-mention-subtitle'>{match.subtitle}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

const AskMentionMenuPanel = memo(AskMentionMenuPanelComponent);

function AskMentionMenuComponent({
  open,
  anchorRect,
  matches,
  activeIndex,
  isLoading,
  trigger,
  triggerRef,
  onClose,
  onSelect,
}: AskMentionMenuProps) {
  if (!open || !anchorRect) {
    return null;
  }

  return (
    <AskMentionMenuPanel
      anchorRect={anchorRect}
      matches={matches}
      activeIndex={activeIndex}
      isLoading={isLoading}
      trigger={trigger}
      triggerRef={triggerRef}
      onClose={onClose}
      onSelect={onSelect}
    />
  );
}

const AskMentionMenu = memo(AskMentionMenuComponent);

function insertTextAtCaret(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  text: string,
): { nextValue: string; nextCaret: number } {
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);

  return {
    nextValue: `${before}${text}${after}`,
    nextCaret: selectionStart + text.length,
  };
}

function HomeDashboardAskBarComponent({
  projects,
  viewMode,
  compact = false,
  onAgentOpened,
  onPromptFlightStart,
  onPromptFlightLand,
  onPromptFlightCancel,
}: HomeDashboardAskBarProps) {
  const { addAgentTabForProject, updateAgentTab } = useTabActions();
  const preferredAiProvider = useAppSettingsStore((state) => state.preferredAiProvider);
  const storeProjects = useProjectStore((state) => state.projects);
  const workspaces = useProjectStore((state) => state.workspaces);
  const selectableProjects = useMemo(() => {
    const source = storeProjects.length > 0 ? storeProjects : projects;
    const workspaceOrderById = new Map(
      workspaces.map((workspace, index) => [workspace.id, index]),
    );
    const projectOrderById = new Map(
      storeProjects.map((project, index) => [project.id, index]),
    );

    return [...source].sort((left, right) => {
      const leftWorkspaceOrder = workspaceOrderById.get(left.workspaceId) ?? Number.MAX_SAFE_INTEGER;
      const rightWorkspaceOrder = workspaceOrderById.get(right.workspaceId) ?? Number.MAX_SAFE_INTEGER;
      if (leftWorkspaceOrder !== rightWorkspaceOrder) {
        return leftWorkspaceOrder - rightWorkspaceOrder;
      }

      const leftProjectOrder = projectOrderById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightProjectOrder = projectOrderById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftProjectOrder - rightProjectOrder;
    });
  }, [projects, storeProjects, workspaces]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  const mentionTriggerRef = useRef<HTMLButtonElement>(null);
  const aiProviderTriggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef('');
  const pendingImagesRef = useRef<PendingAskImage[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [caretIndex, setCaretIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [agentMode, setAgentMode] = useState<AutomationAgentMode>('agent');
  const [pendingImages, setPendingImages] = useState<PendingAskImage[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachAnchorRect, setAttachAnchorRect] = useState<DOMRect | null>(null);
  const [aiProviderMenuOpen, setAiProviderMenuOpen] = useState(false);
  const [aiProviderAnchorRect, setAiProviderAnchorRect] = useState<DOMRect | null>(null);
  const [aiProvider, setAiProvider] = useState<Exclude<AiProviderId, 'nexus'>>(
    () => useAppSettingsStore.getState().preferredAiProvider,
  );
  const [mentionAnchorRect, setMentionAnchorRect] = useState<DOMRect | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [skillHints, setSkillHints] = useState<TerminalCommandHint[]>(EMPTY_SKILL_HINTS);

  promptRef.current = prompt;
  pendingImagesRef.current = pendingImages;

  const focusPromptInput = useCallback((delayMs = 0) => {
    window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, delayMs);
  }, []);

  useEffect(() => {
    focusPromptInput();
  }, [focusPromptInput, viewMode]);

  useEffect(() => {
    const handleAskFocus = () => {
      focusPromptInput();
    };

    window.addEventListener(HOME_ASK_FOCUS_EVENT, handleAskFocus);
    return () => {
      window.removeEventListener(HOME_ASK_FOCUS_EVENT, handleAskFocus);
    };
  }, [focusPromptInput]);

  useEffect(() => {
    if (selectableProjects.length === 0) {
      if (projectId) {
        setProjectId('');
      }
      return;
    }

    if (!projectId || !selectableProjects.some((project) => project.id === projectId)) {
      setProjectId(selectableProjects[0]?.id ?? '');
    }
  }, [projectId, selectableProjects]);

  const handleProjectChange = useCallback(
    (value: string) => {
      setProjectId(value);
      focusPromptInput(80);
    },
    [focusPromptInput],
  );

  const handleProjectMenuOpenChange = useCallback((nextOpen: boolean) => {
    setProjectMenuOpen(nextOpen);
  }, []);

  const handleCycleProject = useCallback(() => {
    if (selectableProjects.length === 0 || submitting) {
      return;
    }

    const currentIndex = selectableProjects.findIndex((project) => project.id === projectId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % selectableProjects.length;
    const nextId = selectableProjects[nextIndex]?.id ?? '';

    if (nextId) {
      setProjectId(nextId);
    }

    setProjectMenuOpen(true);
    focusPromptInput();
  }, [focusPromptInput, projectId, selectableProjects, submitting]);

  const selectedProject = useMemo(
    () => selectableProjects.find((project) => project.id === projectId) ?? null,
    [projectId, selectableProjects],
  );

  const projectOptions = useMemo(() => {
    const showWorkspace = workspaces.length > 1;
    const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));

    return selectableProjects.map((project) => ({
      value: project.id,
      label: project.name,
      subtitle: showWorkspace ? workspaceNameById.get(project.workspaceId) : undefined,
      icon: <AskProjectThumb logo={project.logo} icon={project.icon} color={project.color} />,
    }));
  }, [selectableProjects, workspaces]);

  const triggerLeadingIcon = useMemo(() => {
    if (!selectedProject) {
      return <FolderKanban size={14} strokeWidth={2} />;
    }

    return (
      <AskProjectThumb
        logo={selectedProject.logo}
        icon={selectedProject.icon}
        color={selectedProject.color}
      />
    );
  }, [selectedProject]);

  const projectPath = selectedProject?.path ?? '';

  useEffect(() => {
    if (!projectPath || !window.nexus?.files) {
      setSkillHints(EMPTY_SKILL_HINTS);
      return;
    }

    let cancelled = false;

    void window.nexus.files.getAgentSkillHints(projectPath).then((entries) => {
      if (!cancelled) {
        setSkillHints(entries.filter((hint) => hint.hintKind === 'skill'));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const mention = useAgentComposerMention({
    draft: prompt,
    caretIndex,
    projectPath,
    isVisible: Boolean(projectPath),
    skillHints,
  });

  useEffect(() => {
    if (!mention.isOpen) {
      setMentionAnchorRect((current) => (current ? null : current));
      return;
    }

    const rect =
      mentionTriggerRef.current?.getBoundingClientRect() ??
      inputRef.current?.getBoundingClientRect() ??
      formRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setMentionAnchorRect((current) => {
      if (
        current &&
        current.top === rect.top &&
        current.left === rect.left &&
        current.width === rect.width &&
        current.height === rect.height
      ) {
        return current;
      }

      return rect;
    });
  }, [mention.isOpen, prompt, caretIndex]);

  const syncCaretIndex = useCallback(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    setCaretIndex(input.selectionStart ?? 0);
  }, []);

  const syncInputScroll = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;

    if (!input || !mirror) {
      return;
    }

    mirror.scrollTop = input.scrollTop;
  }, []);

  const setPromptWithCaret = useCallback((nextValue: string, nextCaret: number) => {
    setPrompt(nextValue);
    setCaretIndex(nextCaret);

    window.requestAnimationFrame(() => {
      const input = inputRef.current;

      if (!input) {
        return;
      }

      input.focus({ preventScroll: true });
      input.setSelectionRange(nextCaret, nextCaret);
      resizeAskInput(input);
      syncInputScroll();
    });
  }, [syncInputScroll]);

  useLayoutEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    resizeAskInput(input);
    syncInputScroll();
  }, [compact, prompt, syncInputScroll]);

  const imagePreviewByNumber = useMemo(() => {
    const map = new Map<number, string>();

    pendingImages.forEach((image, index) => {
      map.set(index + 1, image.dataUrl);
    });

    return map;
  }, [pendingImages]);

  const canSubmit =
    (prompt.trim().length > 0 || pendingImages.length > 0) && Boolean(projectId) && !submitting;
  const projectActionsDisabled = !projectId || submitting;
  const imageActionsDisabled = submitting;
  const activeModeOption = getAgentModeOption(agentMode);
  const selectedAiProviderLabel =
    ASK_AI_PROVIDER_OPTIONS.find((option) => option.id === aiProvider)?.label ?? 'Cursor';
  const askPlaceholder =
    agentMode !== 'agent'
      ? AGENT_MODE_INPUT_PLACEHOLDERS[agentMode]
      : 'Pergunte algo ao Nexus...';

  const handleClearMode = useCallback(() => {
    setAgentMode('agent');
    focusPromptInput();
  }, [focusPromptInput]);

  const handleCycleMode = useCallback(() => {
    setAgentMode((current) => cycleAgentMode(current));
    focusPromptInput();
  }, [focusPromptInput]);

  useEffect(() => {
    const mentioned = new Set<number>();
    const pattern = new RegExp(
      AGENT_PROMPT_IMAGE_MENTION_REGEX.source,
      AGENT_PROMPT_IMAGE_MENTION_REGEX.flags,
    );

    for (const match of prompt.matchAll(pattern)) {
      const imageNumber = Number.parseInt(match[1] ?? '', 10);

      if (Number.isFinite(imageNumber) && imageNumber > 0) {
        mentioned.add(imageNumber);
      }
    }

    setPendingImages((current) => {
      if (current.length === 0) {
        return current;
      }

      const next = current.filter((_, index) => mentioned.has(index + 1));
      return next.length === current.length ? current : next;
    });
  }, [prompt]);

  const insertPathMentions = useCallback(
    (mentions: string[]) => {
      if (mentions.length === 0) {
        return;
      }

      const input = inputRef.current;
      const selectionStart = input?.selectionStart ?? prompt.length;
      const selectionEnd = input?.selectionEnd ?? selectionStart;
      const { nextDraft, nextCaret } = buildAgentComposerMentionsInsertion(
        prompt,
        selectionStart,
        selectionEnd,
        mentions,
      );

      setPromptWithCaret(nextDraft, nextCaret);
    },
    [prompt, setPromptWithCaret],
  );

  const attachImagesWithMentions = useCallback(
    (dataUrls: string[]) => {
      if (dataUrls.length === 0) {
        return;
      }

      const selectionStart = inputRef.current?.selectionStart ?? promptRef.current.length;
      let nextPrompt = promptRef.current;
      let nextCaret = selectionStart;
      const merged = [...pendingImagesRef.current];

      for (const dataUrl of dataUrls) {
        const imageNumber = merged.length + 1;
        const insertion = buildAgentPromptImageMentionInsertion(
          nextPrompt,
          nextCaret,
          nextCaret,
          imageNumber,
        );
        nextPrompt = insertion.nextDraft;
        nextCaret = insertion.nextCaret;
        merged.push({
          id: `${Date.now()}-${imageNumber}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl,
        });
      }

      pendingImagesRef.current = merged;
      promptRef.current = nextPrompt;
      setPendingImages(merged);
      setPromptWithCaret(nextPrompt, nextCaret);
    },
    [setPromptWithCaret],
  );

  const removePendingImage = useCallback(
    (imageId: string) => {
      if (imageActionsDisabled) {
        return;
      }

      const images = pendingImagesRef.current;
      const index = images.findIndex((image) => image.id === imageId);

      if (index < 0) {
        return;
      }

      const kept = images.filter((image) => image.id !== imageId);
      const mentionPattern = new RegExp(
        AGENT_PROMPT_IMAGE_MENTION_REGEX.source,
        AGENT_PROMPT_IMAGE_MENTION_REGEX.flags,
      );
      const nextPrompt = promptRef.current
        .replace(mentionPattern, (full, rawNumber: string) => {
          const oldNumber = Number.parseInt(rawNumber, 10);

          if (!Number.isFinite(oldNumber) || oldNumber <= 0) {
            return full;
          }

          if (oldNumber === index + 1) {
            return '';
          }

          if (oldNumber > index + 1) {
            return buildAgentPromptImageMention(oldNumber - 1);
          }

          return buildAgentPromptImageMention(oldNumber);
        })
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n');

      pendingImagesRef.current = kept;
      promptRef.current = nextPrompt;
      setPendingImages(kept);
      setPromptWithCaret(nextPrompt, Math.min(caretIndex, nextPrompt.length));
    },
    [caretIndex, imageActionsDisabled, setPromptWithCaret],
  );

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    const project =
      useProjectStore.getState().projects.find((item) => item.id === projectId) ??
      projects.find((item) => item.id === projectId);

    if ((!trimmed && pendingImages.length === 0) || !project || submitting) {
      return;
    }

    const imageDataUrls = pendingImages.map((image) => image.dataUrl);
    const snapshot = {
      prompt,
      caretIndex,
      pendingImages,
      projectId,
    };
    const nextPrompt = trimmed;

    const flightSource = formRef.current ?? inputRef.current;
    const sourceRect = flightSource?.getBoundingClientRect();
    const flightId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const flightText = trimmed || (pendingImages.length > 0 ? 'Imagem anexada' : '');

    if (sourceRect && flightText) {
      onPromptFlightStart?.({
        id: flightId,
        text: flightText,
        projectName: project.name,
        projectColor: project.color,
        fromRect: {
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
        },
      });
    }

    setPrompt('');
    setCaretIndex(0);
    setPendingImages([]);
    setSubmitting(true);
    onAgentOpened?.();

    try {
      const paneId = await executeHomeDashboardAgentPrompt({
        project,
        prompt: nextPrompt,
        imageDataUrls,
        preferredPaneId: null,
        agentMode,
        aiProvider,
        addAgentTabForProject,
        syncAgentWorkingDirectory: async (nextPaneId, workingDirectory) => {
          await updateAgentTab(nextPaneId, { workingDirectory });
        },
      });

      if (paneId) {
        onPromptFlightLand?.(flightId, paneId);
        return;
      }

      setPrompt(snapshot.prompt);
      setCaretIndex(snapshot.caretIndex);
      setPendingImages(snapshot.pendingImages);
      setProjectId(snapshot.projectId);
      onPromptFlightCancel?.(flightId);
    } catch {
      setPrompt(snapshot.prompt);
      setCaretIndex(snapshot.caretIndex);
      setPendingImages(snapshot.pendingImages);
      setProjectId(snapshot.projectId);
      onPromptFlightCancel?.(flightId);
    } finally {
      setSubmitting(false);
    }
  }, [
    addAgentTabForProject,
    agentMode,
    aiProvider,
    caretIndex,
    onAgentOpened,
    onPromptFlightCancel,
    onPromptFlightLand,
    onPromptFlightStart,
    pendingImages,
    projectId,
    projects,
    prompt,
    submitting,
    updateAgentTab,
  ]);

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleSubmit();
    },
    [handleSubmit],
  );

  const handleMentionSelect = useCallback(
    (match: ComposerMentionMatch) => {
      if (!mention.mentionContext) {
        return;
      }

      const { nextValue, nextCaret } = applyComposerMention(
        prompt,
        mention.mentionContext.startIndex,
        mention.mentionContext.endIndex,
        match.insertText,
      );

      mention.dismiss();
      setPromptWithCaret(nextValue, nextCaret);
    },
    [mention, prompt, setPromptWithCaret],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (mention.isOpen) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          mention.moveDown();
          return;
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault();
          mention.moveUp();
          return;
        }

        if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
          const activeMatch = mention.getActiveMatch();

          if (activeMatch) {
            event.preventDefault();
            handleMentionSelect(activeMatch);
            return;
          }

          if (event.key === 'Tab') {
            event.preventDefault();
            return;
          }
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          mention.dismiss();
          return;
        }
      }

      if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        handleCycleMode();
        return;
      }

      if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        handleCycleProject();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleCycleMode, handleCycleProject, handleMentionSelect, handleSubmit, mention],
  );

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (imageActionsDisabled) {
        return;
      }

      const clipboard = event.clipboardData;

      if (!clipboard) {
        return;
      }

      let imageFile: File | null = null;

      for (const item of clipboard.items) {
        if (!item.type.startsWith('image/')) {
          continue;
        }

        const file = item.getAsFile();

        if (file) {
          imageFile = file;
          break;
        }
      }

      if (!imageFile) {
        for (const file of clipboard.files) {
          if (file.type.startsWith('image/')) {
            imageFile = file;
            break;
          }
        }
      }

      if (!imageFile) {
        return;
      }

      event.preventDefault();

      void (async () => {
        try {
          const dataUrl = await blobToDataUrl(imageFile);
          attachImagesWithMentions([dataUrl]);
        } catch {
        }
      })();
    },
    [attachImagesWithMentions, imageActionsDisabled],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (imageActionsDisabled) {
        return;
      }

      if (!isExternalFileDrag(event.dataTransfer) && event.dataTransfer.types.length === 0) {
        return;
      }

      event.preventDefault();
      setDropActive(true);
    },
    [imageActionsDisabled],
  );

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    const related = event.relatedTarget as Node | null;

    if (!formRef.current?.contains(related)) {
      setDropActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDropActive(false);

      if (imageActionsDisabled) {
        return;
      }

      void (async () => {
        const dataTransfer = event.dataTransfer;

        if (isExternalFileDrag(dataTransfer)) {
          const dataUrls = await readDroppedImageDataUrls(dataTransfer);

          if (dataUrls.length > 0) {
            attachImagesWithMentions(dataUrls);
          }

          if (selectedProject) {
            const mentions = await resolveAgentComposerDropMentions(
              selectedProject.path,
              dataTransfer,
              {
                includeImages: false,
              },
            );

            if (mentions.length > 0) {
              insertPathMentions(mentions);
            }
          }

          focusPromptInput();
          return;
        }

        if (!selectedProject) {
          return;
        }

        const mentions = await resolveAgentComposerDropMentions(selectedProject.path, dataTransfer);

        if (mentions.length > 0) {
          insertPathMentions(mentions);
          focusPromptInput();
        }
      })();
    },
    [
      attachImagesWithMentions,
      focusPromptInput,
      imageActionsDisabled,
      insertPathMentions,
      selectedProject,
    ],
  );

  const handleCloseAttachMenu = useCallback(() => {
    setAttachMenuOpen(false);
  }, []);

  const handleCloseAiProviderMenu = useCallback(() => {
    setAiProviderMenuOpen(false);
  }, []);

  const handleSelectAiProvider = useCallback((provider: Exclude<AiProviderId, 'nexus'>) => {
    setAiProvider(provider);
  }, []);

  const handleCloseMentionMenu = useCallback(() => {
    mention.dismiss();
  }, [mention.dismiss]);

  const handleToggleAttachMenu = useCallback(() => {
    if (imageActionsDisabled) {
      return;
    }

    if (attachMenuOpen) {
      setAttachMenuOpen(false);
      return;
    }

    const rect = attachTriggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAttachAnchorRect(rect);
    setAttachMenuOpen(true);
    setAiProviderMenuOpen(false);
  }, [attachMenuOpen, imageActionsDisabled]);

  const handleToggleAiProviderMenu = useCallback(() => {
    if (aiProviderMenuOpen) {
      setAiProviderMenuOpen(false);
      return;
    }

    const rect = aiProviderTriggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAiProviderAnchorRect(rect);
    setAiProviderMenuOpen(true);
    setAttachMenuOpen(false);
  }, [aiProviderMenuOpen]);

  const handleAttachFile = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    const sourcePaths = await window.nexus.dialog.openFiles();

    if (!sourcePaths || sourcePaths.length === 0) {
      return;
    }

    const mentions: string[] = [];

    for (const sourcePath of sourcePaths) {
      const mentionText = await resolveAgentComposerPathMention(selectedProject.path, sourcePath);

      if (mentionText) {
        mentions.push(mentionText);
      }
    }

    insertPathMentions(mentions);
  }, [insertPathMentions, selectedProject]);

  const handleAttachImage = useCallback(async () => {
    if (imageActionsDisabled) {
      return;
    }

    const sourcePaths = await window.nexus.dialog.openImages();

    if (!sourcePaths || sourcePaths.length === 0) {
      return;
    }

    const dataUrls: string[] = [];

    for (const sourcePath of sourcePaths) {
      const dataUrl = await readImagePathAsDataUrl(sourcePath);

      if (dataUrl) {
        dataUrls.push(dataUrl);
      }
    }

    attachImagesWithMentions(dataUrls);
  }, [attachImagesWithMentions, imageActionsDisabled]);

  const handleAttachImageClick = useCallback(() => {
    void handleAttachImage();
  }, [handleAttachImage]);

  const handleAttachFileClick = useCallback(() => {
    void handleAttachFile();
  }, [handleAttachFile]);

  const handleMentionClick = useCallback(() => {
    if (projectActionsDisabled) {
      return;
    }

    const input = inputRef.current;
    const selectionStart = input?.selectionStart ?? prompt.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;
    const needsSpace = selectionStart > 0 && !/\s$/.test(prompt.slice(0, selectionStart));
    const insertion = `${needsSpace ? ' ' : ''}@`;
    const { nextValue, nextCaret } = insertTextAtCaret(
      prompt,
      selectionStart,
      selectionEnd,
      insertion,
    );

    setPromptWithCaret(nextValue, nextCaret);
  }, [projectActionsDisabled, prompt, setPromptWithCaret]);

  return (
    <form
      ref={formRef}
      className={`home-dashboard__ask app-button--enter${dropActive ? ' home-dashboard__ask--drop-target' : ''}`}
      onSubmit={handleFormSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AnchoredSelect
        value={projectId}
        options={projectOptions}
        placeholder='Escolha um projeto'
        onChange={handleProjectChange}
        leadingIcon={triggerLeadingIcon}
        className='home-dashboard__ask-project-wrap'
        triggerClassName='home-dashboard__ask-project'
        disabled={selectableProjects.length === 0 || submitting}
        open={projectMenuOpen}
        onOpenChange={handleProjectMenuOpenChange}
      />
      <div className='home-dashboard__ask-main'>
        {pendingImages.length > 0 ? (
          <div className='home-dashboard__ask-attachments app-button--enter' aria-label='Anexos'>
            {pendingImages.map((image, index) => {
              const imageNumber = index + 1;
              const badgeColor = getAgentPromptImageBadgeColor(imageNumber);

              return (
                <div key={image.id} className='home-dashboard__ask-attachment app-button--enter'>
                  <span
                    className='home-dashboard__ask-attachment-index'
                    style={{ '--prompt-image-badge-color': badgeColor } as CSSProperties}
                    aria-hidden='true'
                  >
                    {imageNumber}
                  </span>
                  <span className='home-dashboard__ask-attachment-thumb-btn'>
                    <img
                      src={image.dataUrl}
                      alt=''
                      className='home-dashboard__ask-attachment-thumb'
                      draggable={false}
                    />
                  </span>
                  <button
                    type='button'
                    className='home-dashboard__ask-attachment-remove app-button app-button--enter'
                    aria-label={`Remover imagem ${imageNumber}`}
                    disabled={imageActionsDisabled}
                    onClick={() => removePendingImage(image.id)}
                  >
                    <X size={12} strokeWidth={2.5} aria-hidden='true' />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className='home-dashboard__ask-input-wrap'>
          <div ref={mirrorRef} className='home-dashboard__ask-input-mirror' aria-hidden='true'>
            {prompt ? (
              <AgentPromptImageMentionText
                text={prompt}
                alignWidth
                imagePreviewByNumber={imagePreviewByNumber}
              />
            ) : (
              <span className='home-dashboard__ask-input-mirror-placeholder'>
                {askPlaceholder}
              </span>
            )}
          </div>
          <textarea
            ref={inputRef}
            className='home-dashboard__ask-input home-dashboard__ask-input--mirrored'
            value={prompt}
            rows={1}
            onChange={(event) => {
              setPrompt(event.target.value);
              setCaretIndex(event.target.selectionStart ?? event.target.value.length);
              resizeAskInput(event.target);
              syncInputScroll();
            }}
            onClick={syncCaretIndex}
            onKeyUp={syncCaretIndex}
            onSelect={syncCaretIndex}
            onScroll={syncInputScroll}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={askPlaceholder}
            disabled={submitting}
            spellCheck={false}
            aria-label='Pergunte algo ao Nexus'
          />
        </div>
      </div>
      <div className='home-dashboard__ask-actions'>
        {agentMode !== 'agent' && activeModeOption ? (
          <AgentComposerModeChip
            mode={agentMode}
            option={activeModeOption}
            onClear={handleClearMode}
          />
        ) : null}
        <button
          ref={attachTriggerRef}
          type='button'
          className={`home-dashboard__ask-action app-button${attachMenuOpen ? ' home-dashboard__ask-action--open' : ''}`}
          aria-label='Anexar'
          aria-haspopup='menu'
          aria-expanded={attachMenuOpen}
          disabled={imageActionsDisabled}
          onClick={handleToggleAttachMenu}
        >
          <Paperclip size={16} strokeWidth={2} aria-hidden='true' />
        </button>
        <button
          ref={mentionTriggerRef}
          type='button'
          className='home-dashboard__ask-action app-button'
          aria-label='Mencionar arquivo'
          disabled={projectActionsDisabled}
          onClick={handleMentionClick}
        >
          <AtSign size={16} strokeWidth={2} aria-hidden='true' />
        </button>
        <button
          ref={aiProviderTriggerRef}
          type='button'
          className={`home-dashboard__ask-action app-button${
            aiProviderMenuOpen ? ' home-dashboard__ask-action--open' : ''
          }${
            aiProvider !== preferredAiProvider && !aiProviderMenuOpen
              ? ' home-dashboard__ask-action--active'
              : ''
          }`}
          aria-label={`IA deste agent: ${selectedAiProviderLabel}`}
          aria-haspopup='menu'
          aria-expanded={aiProviderMenuOpen}
          title={`IA deste agent: ${selectedAiProviderLabel}`}
          onClick={handleToggleAiProviderMenu}
        >
          <AskAiProviderLogo provider={aiProvider} />
        </button>
        <button
          type='submit'
          className='home-dashboard__ask-send app-button app-button--enter'
          aria-label='Enviar'
          disabled={!canSubmit}
        >
          <ArrowUp size={16} strokeWidth={2.25} aria-hidden='true' />
        </button>
      </div>
      <AskAttachMenu
        open={attachMenuOpen}
        anchorRect={attachAnchorRect}
        triggerRef={attachTriggerRef}
        onClose={handleCloseAttachMenu}
        onAttachImage={handleAttachImageClick}
        onAttachFile={handleAttachFileClick}
      />
      <AskAiProviderMenu
        open={aiProviderMenuOpen}
        anchorRect={aiProviderAnchorRect}
        triggerRef={aiProviderTriggerRef}
        value={aiProvider}
        onClose={handleCloseAiProviderMenu}
        onSelect={handleSelectAiProvider}
      />
      <AskMentionMenu
        open={mention.isOpen}
        anchorRect={mentionAnchorRect}
        matches={mention.matches}
        activeIndex={mention.activeIndex}
        isLoading={mention.isLoading}
        trigger={mention.mentionContext?.trigger ?? '@'}
        triggerRef={mentionTriggerRef}
        onClose={handleCloseMentionMenu}
        onSelect={handleMentionSelect}
      />
    </form>
  );
}

export const HomeDashboardAskBar = memo(HomeDashboardAskBarComponent);
