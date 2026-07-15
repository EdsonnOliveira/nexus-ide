import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
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
  File,
  FileText,
  FolderKanban,
  Globe,
  Image,
  Paperclip,
} from 'lucide-react';
import { AgentPromptImageMentionText } from '@/components/agent/AgentPromptImageBadges';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { HomeDashboardViewMode } from '@/components/home/HomeDashboardModeSwitch';
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
  buildAgentPromptImageMentionInsertion,
} from '@/utils/agentPromptImageBadge';
import {
  readDroppedImageDataUrls,
  readImagePathAsDataUrl,
} from '@/utils/attachAgentPromptImage';
import { executeHomeDashboardAgentPrompt } from '@/utils/executeHomeDashboardAgentPrompt';
import { isExternalFileDrag } from '@/utils/explorerExternalDrop';
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

interface AskMentionMenuProps {
  open: boolean;
  anchorRect: DOMRect | null;
  matches: ComposerMentionMatch[];
  activeIndex: number;
  isLoading: boolean;
  trigger: '@' | '/';
  onClose: () => void;
  onSelect: (match: ComposerMentionMatch) => void;
}

function resizeAskInput(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(96, Math.max(40, textarea.scrollHeight))}px`;
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

function AskMentionMenuPanelComponent({
  anchorRect,
  matches,
  activeIndex,
  isLoading,
  trigger,
  onClose,
  onSelect,
}: Omit<AskMentionMenuProps, 'open'>) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => {
      positionDropdownAboveAnchor(menu, anchorRect!, 'start');
    },
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown, true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [menuRef, requestClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu agent-view__composer-mention-menu overlay-popup ${animationClass}`}
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
  onAgentOpened,
  onPromptFlightStart,
  onPromptFlightLand,
  onPromptFlightCancel,
}: HomeDashboardAskBarProps) {
  const projectsFromStore = useProjectStore((state) => state.projects);
  const { addAgentTabForProject, updateAgentTab } = useTabActions();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef('');
  const pendingImagesRef = useRef<PendingAskImage[]>([]);
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [caretIndex, setCaretIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingAskImage[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachAnchorRect, setAttachAnchorRect] = useState<DOMRect | null>(null);
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

  const handleProjectChange = useCallback(
    (value: string) => {
      setProjectId(value);
      focusPromptInput(80);
    },
    [focusPromptInput],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.name,
        icon: (
          <AskProjectThumb logo={project.logo} icon={project.icon} color={project.color} />
        ),
      })),
    [projects],
  );

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

    const rect = formRef.current?.getBoundingClientRect() ?? inputRef.current?.getBoundingClientRect();

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

  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    resizeAskInput(input);
    syncInputScroll();
  }, [prompt, syncInputScroll]);

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

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    const project =
      projectsFromStore.find((item) => item.id === projectId) ??
      projects.find((item) => item.id === projectId);

    if ((!trimmed && pendingImages.length === 0) || !project || submitting) {
      return;
    }

    const imageDataUrls = pendingImages.map((image) => image.dataUrl);
    const snapshot = {
      prompt,
      caretIndex,
      pendingImages,
      webSearchEnabled,
      projectId,
    };
    let nextPrompt = trimmed;

    if (webSearchEnabled) {
      nextPrompt = nextPrompt
        ? `Pesquise na web quando necessário.\n\n${nextPrompt}`
        : 'Pesquise na web quando necessário.';
    }

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
    setWebSearchEnabled(false);
    setProjectId('');
    setSubmitting(true);
    onAgentOpened?.();

    try {
      const paneId = await executeHomeDashboardAgentPrompt({
        project,
        prompt: nextPrompt,
        imageDataUrls,
        preferredPaneId: null,
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
      setWebSearchEnabled(snapshot.webSearchEnabled);
      setProjectId(snapshot.projectId);
      onPromptFlightCancel?.(flightId);
    } catch {
      setPrompt(snapshot.prompt);
      setCaretIndex(snapshot.caretIndex);
      setPendingImages(snapshot.pendingImages);
      setWebSearchEnabled(snapshot.webSearchEnabled);
      setProjectId(snapshot.projectId);
      onPromptFlightCancel?.(flightId);
    } finally {
      setSubmitting(false);
    }
  }, [
    addAgentTabForProject,
    caretIndex,
    onAgentOpened,
    onPromptFlightCancel,
    onPromptFlightLand,
    onPromptFlightStart,
    pendingImages,
    projectId,
    projects,
    projectsFromStore,
    prompt,
    submitting,
    updateAgentTab,
    webSearchEnabled,
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

        if (event.key === 'Enter' || event.key === 'Tab') {
          const activeMatch = mention.getActiveMatch();

          if (activeMatch) {
            event.preventDefault();
            handleMentionSelect(activeMatch);
            return;
          }
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          mention.dismiss();
          return;
        }
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSubmit();
      }
    },
    [handleMentionSelect, handleSubmit, mention],
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
  }, [attachMenuOpen, imageActionsDisabled]);

  const handleAttachFile = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    const sourcePath = await window.nexus.dialog.openFile();

    if (!sourcePath) {
      return;
    }

    const mentionText = await resolveAgentComposerPathMention(selectedProject.path, sourcePath);

    if (!mentionText) {
      return;
    }

    insertPathMentions([mentionText]);
  }, [insertPathMentions, selectedProject]);

  const handleAttachImage = useCallback(async () => {
    if (imageActionsDisabled) {
      return;
    }

    const sourcePath = await window.nexus.dialog.openImage();

    if (!sourcePath) {
      return;
    }

    const dataUrl = await readImagePathAsDataUrl(sourcePath);

    if (!dataUrl) {
      return;
    }

    attachImagesWithMentions([dataUrl]);
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

  const handleToggleWebSearch = useCallback(() => {
    if (submitting) {
      return;
    }

    setWebSearchEnabled((current) => !current);
    focusPromptInput();
  }, [focusPromptInput, submitting]);

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
        allowEmpty
        emptyLabel='Todos os Projetos'
        onChange={handleProjectChange}
        leadingIcon={triggerLeadingIcon}
        className='home-dashboard__ask-project-wrap'
        triggerClassName='home-dashboard__ask-project'
        disabled={projects.length === 0 || submitting}
      />
      <div className='home-dashboard__ask-main'>
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
                Pergunte algo ao Nexus...
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
            placeholder='Pergunte algo ao Nexus...'
            disabled={submitting}
            spellCheck={false}
            aria-label='Pergunte algo ao Nexus'
          />
        </div>
      </div>
      <div className='home-dashboard__ask-actions'>
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
          type='button'
          className='home-dashboard__ask-action app-button'
          aria-label='Mencionar arquivo'
          disabled={projectActionsDisabled}
          onClick={handleMentionClick}
        >
          <AtSign size={16} strokeWidth={2} aria-hidden='true' />
        </button>
        <button
          type='button'
          className={`home-dashboard__ask-action app-button${webSearchEnabled ? ' home-dashboard__ask-action--active' : ''}`}
          aria-label='Pesquisar na web'
          aria-pressed={webSearchEnabled}
          disabled={submitting}
          onClick={handleToggleWebSearch}
        >
          <Globe size={16} strokeWidth={2} aria-hidden='true' />
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
      <AskMentionMenu
        open={mention.isOpen}
        anchorRect={mentionAnchorRect}
        matches={mention.matches}
        activeIndex={mention.activeIndex}
        isLoading={mention.isLoading}
        trigger={mention.mentionContext?.trigger ?? '@'}
        onClose={handleCloseMentionMenu}
        onSelect={handleMentionSelect}
      />
    </form>
  );
}

export const HomeDashboardAskBar = memo(HomeDashboardAskBarComponent);
