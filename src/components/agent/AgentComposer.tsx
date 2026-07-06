import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, BookOpen, File, Pencil, Square, X } from 'lucide-react';
import {
  AGENT_MODE_INPUT_PLACEHOLDERS,
  getAgentModeOption,
} from '@/constants/agentModes';
import { AgentComposerModeChip } from '@/components/agent/AgentComposerModeChip';
import {
  AgentComposerModelSelect,
  AgentComposerPlusMenu,
  useAgentModelHints,
} from '@/components/agent/AgentHintBar';
import {
  AgentPromptImageIndexBadge,
  AgentPromptImageMentionText,
} from '@/components/agent/AgentPromptImageBadges';
import { AgentLiveStatus } from '@/components/agent/AgentLiveStatus';
import { AgentContextUsageIndicator } from '@/components/agent/AgentContextUsageIndicator';
import { AgentCursorUsageIndicator } from '@/components/agent/AgentCursorUsageIndicator';
import { ExplorerDirectoryIcon, ExplorerFileIcon } from '@/components/explorer/ExplorerTreeIcon';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import { useAgentComposerMention } from '@/hooks/useAgentComposerMention';
import {
  positionDropdownAboveComposerInput,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useAgentComposerShortcuts } from '@/hooks/useAgentComposerShortcuts';
import { useCursorUsage } from '@/hooks/useCursorUsage';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import type { TerminalAgent } from '@/types';
import {
  attachAgentPromptImageToPane,
  readDroppedImageDataUrls,
  readImagePathAsDataUrl,
  saveAgentPromptImage,
} from '@/utils/attachAgentPromptImage';
import { blobToDataUrl } from '@/utils/terminalClipboardImage';
import { writeAgentPaneDraft } from '@/utils/agentPaneRegistry';
import {
  buildAgentComposerMentionsAppendFragment,
  buildAgentComposerMentionsInsertion,
  canAcceptAgentComposerDrop,
  resolveAgentComposerDropEffect,
  resolveAgentComposerDropMentions,
} from '@/utils/agentComposerDrop';
import {
  buildAgentPromptImageMention,
  buildAgentPromptImageMentionAppendFragment,
  buildAgentPromptImageMentionInsertion,
} from '@/utils/agentPromptImageBadge';
import { isExternalFileDrag } from '@/utils/explorerExternalDrop';
import { parseComposerSkillDraft } from '@/utils/agentSkillDisplay';
import {
  applyComposerMention,
  type ComposerMentionMatch,
  type ComposerMentionTrigger,
} from '@/utils/agentComposerMention';
import type { AgentContextUsageSnapshot } from '@/utils/agentContextUsageParser';
import type { ProjectKind, TerminalCommandHint } from '@/types';

interface AgentComposerProps {
  paneId: string;
  projectPath: string;
  terminalAgent: TerminalAgent;
  isVisible: boolean;
  isFocused: boolean;
  isBusy: boolean;
  isBootstrapping: boolean;
  isSubmitting: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: string;
  contextUsage: AgentContextUsageSnapshot | null;
  contextUsageLoading: boolean;
  promptHistory?: string[];
  onDraftChange: (value: string) => void;
  onSubmit: (draft: string) => boolean | Promise<boolean>;
  onStop: () => boolean;
  onRunCommand: (command: string) => boolean;
  onRequestContextUsageReport: () => void;
  questionPending?: boolean;
  planPending?: boolean;
  isEditing?: boolean;
  onCancelEdit?: () => void;
}

const EMPTY_PASTE_IMAGES: never[] = [];
const COMPOSER_INPUT_MAX_HEIGHT = 160;

function canNavigatePromptHistoryUp(textarea: HTMLTextAreaElement): boolean {
  if (textarea.selectionStart !== textarea.selectionEnd) {
    return false;
  }

  return !textarea.value.slice(0, textarea.selectionStart).includes('\n');
}

function canNavigatePromptHistoryDown(textarea: HTMLTextAreaElement): boolean {
  if (textarea.selectionStart !== textarea.selectionEnd) {
    return false;
  }

  return !textarea.value.slice(textarea.selectionStart).includes('\n');
}

function resizeComposerInput(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  const nextHeight = Math.min(textarea.scrollHeight, COMPOSER_INPUT_MAX_HEIGHT);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > COMPOSER_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
}

function normalizeMentionFsPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function getMentionProjectKindBadgeLabel(kind: ProjectKind): string {
  if (kind === 'mobile') {
    return 'APP';
  }

  return kind.toUpperCase();
}

const PROJECT_KIND_BADGE_COLORS: Record<ProjectKind, string> = {
  api: '#93c5fd',
  web: '#6ee7b7',
  mobile: '#fcd34d',
};

interface ComposerMentionProjectThumbProps {
  logo: string | null;
  icon: string;
  color: string;
}

function ComposerMentionProjectThumbComponent({
  logo,
  icon,
  color,
}: ComposerMentionProjectThumbProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!logo) {
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
        src={logoSrc}
        alt=''
        className='agent-view__composer-mention-project-logo'
        draggable={false}
        onError={handleLogoError}
      />
    );
  }

  return (
    <span className='agent-view__composer-mention-project-icon' style={{ backgroundColor: color }}>
      <ProjectIconMark icon={icon} size={10} />
    </span>
  );
}

const ComposerMentionProjectThumb = memo(ComposerMentionProjectThumbComponent);

function AgentComposerMentionMatchIconComponent({ match }: { match: ComposerMentionMatch }) {
  const projects = useProjectStore((state) => state.projects);
  const registeredProject = useMemo(() => {
    if (!match.absolutePath) {
      return null;
    }

    const normalized = normalizeMentionFsPath(match.absolutePath);

    return projects.find((project) => normalizeMentionFsPath(project.path) === normalized) ?? null;
  }, [match.absolutePath, projects]);

  if (match.kind === 'skill') {
    return (
      <span className='agent-view__composer-mention-icon' aria-hidden='true'>
        <BookOpen size={14} />
      </span>
    );
  }

  if (match.kind === 'file') {
    return (
      <span className='agent-view__composer-mention-icon' aria-hidden='true'>
        <ExplorerFileIcon name={match.name} />
      </span>
    );
  }

  if (registeredProject) {
    return (
      <span className='agent-view__composer-mention-icon' aria-hidden='true'>
        <ComposerMentionProjectThumb
          logo={registeredProject.logo}
          icon={registeredProject.icon}
          color={registeredProject.color}
        />
      </span>
    );
  }

  if (match.isProjectFolder && match.projectKind) {
    return (
      <span className='agent-view__composer-mention-icon' aria-hidden='true'>
        <span
          className='project-explorer__kind-badge agent-view__composer-mention-kind-badge'
          style={{ backgroundColor: PROJECT_KIND_BADGE_COLORS[match.projectKind], color: '#000' }}
        >
          {getMentionProjectKindBadgeLabel(match.projectKind)}
        </span>
      </span>
    );
  }

  return (
    <span className='agent-view__composer-mention-icon' aria-hidden='true'>
      <ExplorerDirectoryIcon folderName={match.name} expanded={false} />
    </span>
  );
}

const AgentComposerMentionMatchIcon = memo(AgentComposerMentionMatchIconComponent);

interface AgentComposerMentionMenuProps {
  getAnchorRect: () => DOMRect | null;
  matches: ComposerMentionMatch[];
  activeIndex: number;
  isLoading: boolean;
  trigger: ComposerMentionTrigger;
  repositionToken: number;
  onClose: () => void;
  onSelect: (match: ComposerMentionMatch) => void;
}

function AgentComposerMentionMenuComponent({
  getAnchorRect,
  matches,
  activeIndex,
  isLoading,
  trigger,
  repositionToken,
  onClose,
  onSelect,
}: AgentComposerMentionMenuProps) {
  const menuLabel = trigger === '/' ? 'Skills' : 'Menções';
  const emptyMessage = trigger === '/' ? 'Nenhuma skill' : 'Nenhum resultado';

  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => {
      const anchorRect = getAnchorRect();

      if (!anchorRect || (anchorRect.width === 0 && anchorRect.height === 0)) {
        return;
      }

      positionDropdownAboveComposerInput(menu, anchorRect);
    },
    [getAnchorRect, repositionToken],
  );

  return (
    <div
      ref={menuRef}
      className={`context-menu agent-view__composer-mention-menu overlay-popup ${animationClass}`}
      role='listbox'
      aria-label={menuLabel}
    >
      {isLoading && matches.length === 0 ? (
        <div className='agent-view__composer-mention-empty'>Buscando…</div>
      ) : null}
      {!isLoading && matches.length === 0 ? (
        <EmptyState icon={trigger === '/' ? BookOpen : File} message={emptyMessage} compact />
      ) : null}
      {matches.map((match, index) => {
        const isActive = index === activeIndex;

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
            <AgentComposerMentionMatchIcon match={match} />
            <span className='agent-view__composer-mention-label'>{match.label}</span>
            <span className='agent-view__composer-mention-subtitle'>{match.subtitle}</span>
          </button>
        );
      })}
    </div>
  );
}

const AgentComposerMentionMenu = memo(AgentComposerMentionMenuComponent);

function AgentComposerComponent({
  paneId,
  projectPath,
  terminalAgent,
  isVisible,
  isFocused,
  isBusy,
  isBootstrapping,
  isSubmitting,
  inputRef,
  draft,
  contextUsage,
  contextUsageLoading,
  promptHistory = [],
  onDraftChange,
  onSubmit,
  onStop,
  onRunCommand,
  onRequestContextUsageReport,
  questionPending = false,
  planPending = false,
  isEditing = false,
  onCancelEdit,
}: AgentComposerProps) {
  const agentConfig = TERMINAL_AGENTS[terminalAgent];
  const interactionPending = questionPending || planPending;
  const images = useTerminalPasteImageStore((state) => state.imagesByPane[paneId] ?? EMPTY_PASTE_IMAGES);
  const removeImage = useTerminalPasteImageStore((state) => state.removeImage);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caretIndex, setCaretIndex] = useState(0);
  const [mentionRepositionToken, setMentionRepositionToken] = useState(0);
  const composerCardRef = useRef<HTMLDivElement>(null);
  const [composerDropActive, setComposerDropActive] = useState(false);
  const composerInputMirrorRef = useRef<HTMLDivElement>(null);
  const promptHistoryIndexRef = useRef(-1);
  const promptHistoryScratchRef = useRef('');
  const promptHistoryNavigatingRef = useRef(false);
  const [skillHints, setSkillHints] = useState<TerminalCommandHint[]>([]);
  const activeMode = useTerminalSessionStore(
    (state) => state.activeAgentModeByPane[paneId] ?? 'agent',
  );
  const activeModeOption = getAgentModeOption(activeMode);
  const modelHints = useAgentModelHints(paneId, projectPath, isVisible);
  const { usage: cursorUsage, isLoading: cursorUsageLoading, refresh: refreshCursorUsage } =
    useCursorUsage(isVisible);

  useEffect(() => {
    if (!isVisible) {
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
  }, [isVisible, projectPath]);

  const skillDraft = useMemo(
    () => parseComposerSkillDraft(draft, skillHints),
    [draft, skillHints],
  );
  const composerInputValue = skillDraft.hasSkill ? skillDraft.body : draft;
  const mentionCaretIndex = skillDraft.hasSkill
    ? skillDraft.prefixLength + caretIndex
    : caretIndex;

  const mention = useAgentComposerMention({
    draft,
    caretIndex: mentionCaretIndex,
    projectPath,
    isVisible,
    skillHints,
  });

  const getMentionAnchorRect = useCallback((): DOMRect | null => {
    const inputRect = inputRef.current?.getBoundingClientRect();
    const cardRect = composerCardRef.current?.getBoundingClientRect();
    const composerLowerBound = window.innerHeight * 0.3;

    if (inputRect && inputRect.height > 0 && inputRect.bottom > composerLowerBound) {
      return inputRect;
    }

    if (cardRect && cardRect.height > 0 && cardRect.bottom > composerLowerBound) {
      return cardRect;
    }

    if (inputRect && inputRect.height > 0) {
      return inputRect;
    }

    if (cardRect && cardRect.height > 0) {
      return cardRect;
    }

    return null;
  }, [inputRef]);

  useEffect(() => {
    if (!mention.isOpen) {
      return;
    }

    const handleReposition = () => {
      setMentionRepositionToken((token) => token + 1);
    };

    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [mention.isOpen]);

  const syncCaretIndex = useCallback(() => {
    const textarea = inputRef.current;

    if (!textarea) {
      return;
    }

    setCaretIndex(textarea.selectionStart ?? 0);
  }, [inputRef]);

  useLayoutEffect(() => {
    if (!mention.isOpen) {
      return;
    }

    setMentionRepositionToken((token) => token + 1);
  }, [mention.isOpen, draft, caretIndex, skillDraft.hasSkill]);

  const handleMentionSelect = useCallback(
    (match: ComposerMentionMatch) => {
      if (!mention.mentionContext) {
        return;
      }

      const { nextValue, nextCaret } = applyComposerMention(
        draft,
        mention.mentionContext.startIndex,
        mention.mentionContext.endIndex,
        match.insertText,
      );

      onDraftChange(nextValue);
      mention.dismiss();

      window.requestAnimationFrame(() => {
        const textarea = inputRef.current;

        if (!textarea) {
          return;
        }

        const parsed = parseComposerSkillDraft(nextValue, skillHints);
        const nextCaretInInput = parsed.hasSkill
          ? Math.max(0, nextCaret - parsed.prefixLength)
          : nextCaret;

        textarea.focus();
        textarea.setSelectionRange(nextCaretInInput, nextCaretInInput);
        setCaretIndex(nextCaretInInput);
        resizeComposerInput(textarea);
      });
    },
    [draft, inputRef, mention, onDraftChange, skillHints],
  );

  const handleMentionClose = useCallback(() => {
    mention.dismiss();
    inputRef.current?.focus();
  }, [inputRef, mention]);

  const syncComposerInputHeight = useCallback(() => {
    const textarea = inputRef.current;

    if (!textarea) {
      return;
    }

    resizeComposerInput(textarea);
  }, [inputRef]);

  const syncComposerInputScroll = useCallback(() => {
    const textarea = inputRef.current;
    const mirror = composerInputMirrorRef.current;

    if (!textarea || !mirror) {
      return;
    }

    mirror.scrollTop = textarea.scrollTop;
    mirror.scrollLeft = textarea.scrollLeft;
  }, [inputRef]);

  const insertImageMention = useCallback(
    (imageNumber: number) => {
      const textarea = inputRef.current;
      const bodyValue = skillDraft.hasSkill ? skillDraft.body : draft;
      const selectionStart = textarea?.selectionStart ?? bodyValue.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const { nextDraft, nextCaret } = buildAgentPromptImageMentionInsertion(
        bodyValue,
        selectionStart,
        selectionEnd,
        imageNumber,
      );
      const nextValue = skillDraft.hasSkill
        ? nextDraft
          ? `${skillDraft.skillCommand} ${nextDraft}`
          : skillDraft.skillCommand
        : nextDraft;

      onDraftChange(nextValue);

      window.requestAnimationFrame(() => {
        if (!textarea) {
          return;
        }

        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
        setCaretIndex(nextCaret);
        resizeComposerInput(textarea);
        syncComposerInputScroll();
      });
    },
    [draft, inputRef, onDraftChange, skillDraft.body, skillDraft.hasSkill, skillDraft.skillCommand, syncComposerInputScroll],
  );

  const insertMultipleImageMentions = useCallback(
    (imageNumbers: number[]) => {
      if (imageNumbers.length === 0) {
        return;
      }

      if (imageNumbers.length === 1) {
        insertImageMention(imageNumbers[0]!);
        return;
      }

      const textarea = inputRef.current;
      const bodyValue = skillDraft.hasSkill ? skillDraft.body : draft;
      const selectionStart = textarea?.selectionStart ?? bodyValue.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const before = bodyValue.slice(0, selectionStart);
      const after = bodyValue.slice(selectionEnd);
      const needsNewlineBefore = before.length > 0 && !/\n$/.test(before);
      const block = imageNumbers
        .map((n) => `${buildAgentPromptImageMention(n)} = `)
        .join('\n');
      const insertion = `${needsNewlineBefore ? '\n' : ''}${block}\n`;
      const currentDraft = `${before}${insertion}${after}`;
      const currentCaret = selectionStart + insertion.length;

      const nextValue = skillDraft.hasSkill
        ? currentDraft
          ? `${skillDraft.skillCommand} ${currentDraft}`
          : skillDraft.skillCommand
        : currentDraft;

      onDraftChange(nextValue);

      window.requestAnimationFrame(() => {
        if (!textarea) {
          return;
        }

        textarea.focus();
        textarea.setSelectionRange(currentCaret, currentCaret);
        setCaretIndex(currentCaret);
        resizeComposerInput(textarea);
        syncComposerInputScroll();
      });
    },
    [draft, inputRef, insertImageMention, onDraftChange, skillDraft.body, skillDraft.hasSkill, skillDraft.skillCommand, syncComposerInputScroll],
  );

  const attachImageWithMention = useCallback(
    async (dataUrl: string) => {
      const attached = await attachAgentPromptImageToPane(projectPath, paneId, dataUrl, false);

      if (!attached) {
        return;
      }

      insertImageMention(attached.imageNumber);
    },
    [insertImageMention, paneId, projectPath],
  );

  const attachMultipleImagesWithMentions = useCallback(
    async (dataUrls: string[]) => {
      if (dataUrls.length === 0) {
        return;
      }

      if (dataUrls.length === 1) {
        await attachImageWithMention(dataUrls[0]!);
        return;
      }

      const imageNumbers: number[] = [];

      for (const dataUrl of dataUrls) {
        const attached = await saveAgentPromptImage(projectPath, paneId, dataUrl);

        if (attached) {
          imageNumbers.push(attached.imageNumber);
        }
      }

      insertMultipleImageMentions(imageNumbers);
    },
    [attachImageWithMention, insertMultipleImageMentions, paneId, projectPath],
  );

  const insertPathMentions = useCallback(
    (mentions: string[]) => {
      if (mentions.length === 0) {
        return;
      }

      const textarea = inputRef.current;
      const bodyValue = skillDraft.hasSkill ? skillDraft.body : draft;
      const selectionStart = textarea?.selectionStart ?? bodyValue.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const { nextDraft, nextCaret } = buildAgentComposerMentionsInsertion(
        bodyValue,
        selectionStart,
        selectionEnd,
        mentions,
      );
      const nextValue = skillDraft.hasSkill
        ? nextDraft
          ? `${skillDraft.skillCommand} ${nextDraft}`
          : skillDraft.skillCommand
        : nextDraft;

      onDraftChange(nextValue);

      window.requestAnimationFrame(() => {
        if (!textarea) {
          return;
        }

        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
        setCaretIndex(nextCaret);
        resizeComposerInput(textarea);
        syncComposerInputScroll();
      });
    },
    [
      draft,
      inputRef,
      onDraftChange,
      skillDraft.body,
      skillDraft.hasSkill,
      skillDraft.skillCommand,
      syncComposerInputScroll,
    ],
  );

  const handleComposerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canAcceptAgentComposerDrop(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = resolveAgentComposerDropEffect(event.dataTransfer);
    setComposerDropActive(true);
  }, []);

  const handleComposerDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget as Node | null;

    if (!composerCardRef.current?.contains(related)) {
      setComposerDropActive(false);
    }
  }, []);

  const handleComposerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setComposerDropActive(false);

      void (async () => {
        const dataTransfer = event.dataTransfer;

        if (isExternalFileDrag(dataTransfer)) {
          const dataUrls = await readDroppedImageDataUrls(dataTransfer);
          await attachMultipleImagesWithMentions(dataUrls);

          const mentions = await resolveAgentComposerDropMentions(projectPath, dataTransfer, {
            includeImages: false,
          });

          if (mentions.length > 0) {
            insertPathMentions(mentions);
          }

          inputRef.current?.focus();
          return;
        }

        const mentions = await resolveAgentComposerDropMentions(projectPath, dataTransfer);

        if (mentions.length > 0) {
          insertPathMentions(mentions);
          inputRef.current?.focus();
        }
      })();
    },
    [attachMultipleImagesWithMentions, inputRef, insertPathMentions, projectPath],
  );

  useLayoutEffect(() => {
    syncComposerInputHeight();
    syncComposerInputScroll();
  }, [composerInputValue, draft, syncComposerInputHeight, syncComposerInputScroll]);

  const inputPlaceholder = useMemo(() => {
    if (isEditing) {
      return 'Edite a mensagem e envie para substituir a resposta';
    }

    if (questionPending) {
      return 'Responda as perguntas acima';
    }

    if (planPending) {
      return 'Planeje e desenhe antes de...';
    }

    if (activeMode !== 'agent') {
      return AGENT_MODE_INPUT_PLACEHOLDERS[activeMode];
    }

    return agentConfig.inputPlaceholder;
  }, [activeMode, agentConfig.inputPlaceholder, isEditing, planPending, questionPending]);

  const handleClearMode = useCallback(() => {
    onRunCommand('/agent\n');
    inputRef.current?.focus();
  }, [inputRef, onRunCommand]);

  const canStop = isBusy && !draft.trim();
  const hasDraft = Boolean(draft.trim()) || images.length > 0;
  const canSend = hasDraft && !canStop && !interactionPending;
  const isActionDisabled = !canStop && !canSend;
  const waitingLabel = isSubmitting ? 'Enviando…' : 'Iniciando agent…';
  const showWaitingStatus = isSubmitting || isBootstrapping;
  const showContextUsage = Boolean(contextUsage) || contextUsageLoading || canStop;

  const resetPromptHistoryNavigation = useCallback(() => {
    promptHistoryIndexRef.current = -1;
    promptHistoryScratchRef.current = '';
  }, []);

  useEffect(() => {
    resetPromptHistoryNavigation();
  }, [paneId, resetPromptHistoryNavigation]);

  const applyPromptHistoryDraft = useCallback(
    (nextValue: string) => {
      promptHistoryNavigatingRef.current = true;
      onDraftChange(nextValue);
      promptHistoryNavigatingRef.current = false;

      requestAnimationFrame(() => {
        const textarea = inputRef.current;

        if (!textarea) {
          return;
        }

        resizeComposerInput(textarea);
        const cursor = nextValue.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    },
    [inputRef, onDraftChange],
  );

  const navigatePromptHistory = useCallback(
    (direction: 'up' | 'down') => {
      if (promptHistory.length === 0) {
        return;
      }

      if (direction === 'up') {
        if (promptHistoryIndexRef.current === -1) {
          promptHistoryScratchRef.current = draft;
          promptHistoryIndexRef.current = promptHistory.length - 1;
        } else if (promptHistoryIndexRef.current > 0) {
          promptHistoryIndexRef.current -= 1;
        } else {
          return;
        }

        const nextValue = promptHistory[promptHistoryIndexRef.current];

        if (nextValue === undefined) {
          return;
        }

        applyPromptHistoryDraft(nextValue);
        return;
      }

      if (promptHistoryIndexRef.current === -1) {
        return;
      }

      if (promptHistoryIndexRef.current < promptHistory.length - 1) {
        promptHistoryIndexRef.current += 1;
        const nextValue = promptHistory[promptHistoryIndexRef.current];

        if (nextValue === undefined) {
          return;
        }

        applyPromptHistoryDraft(nextValue);
        return;
      }

      promptHistoryIndexRef.current = -1;
      applyPromptHistoryDraft(promptHistoryScratchRef.current);
      promptHistoryScratchRef.current = '';
    },
    [applyPromptHistoryDraft, draft, promptHistory],
  );

  const handleSubmit = useCallback(() => {
    if (interactionPending) {
      return;
    }

    if (canStop) {
      onStop();
      return;
    }

    void (async () => {
      const result = await onSubmit(draft);

      if (result) {
        resetPromptHistoryNavigation();
        onDraftChange('');
      }
    })();
  }, [canStop, draft, interactionPending, onDraftChange, onStop, onSubmit, resetPromptHistoryNavigation]);

  const handleForceSubmit = useCallback(() => {
    if (interactionPending) {
      return;
    }

    void (async () => {
      const result = await onSubmit(draft);

      if (result) {
        resetPromptHistoryNavigation();
        onDraftChange('');
      }
    })();
  }, [draft, interactionPending, onDraftChange, onSubmit, resetPromptHistoryNavigation]);

  const handleModeChange = useCallback(
    (mode: typeof activeMode) => {
      onRunCommand(`/${mode}\n`);
    },
    [onRunCommand],
  );

  const { handleStopOrSubmit } = useAgentComposerShortcuts({
    inputRef,
    isFocused,
    isVisible,
    isBusy,
    draft,
    activeMode,
    modelHints,
    onSubmit: handleSubmit,
    onForceSubmit: handleForceSubmit,
    onStop: () => {
      onStop();
    },
    onModeChange: handleModeChange,
    onRunModelCommand: onRunCommand,
    mentionMenuOpen: mention.isOpen,
  });

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
          }

          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          handleMentionClose();
          return;
        }
      }

      if (isEditing && event.key === 'Escape') {
        event.preventDefault();
        onCancelEdit?.();
        return;
      }

      const textarea = event.currentTarget;

      if (event.key === 'ArrowUp' && canNavigatePromptHistoryUp(textarea)) {
        event.preventDefault();
        navigatePromptHistory('up');
        return;
      }

      if (event.key === 'ArrowDown' && canNavigatePromptHistoryDown(textarea)) {
        event.preventDefault();
        navigatePromptHistory('down');
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleStopOrSubmit();
      }
    },
    [
      handleMentionClose,
      handleMentionSelect,
      handleStopOrSubmit,
      isEditing,
      mention,
      navigatePromptHistory,
      onCancelEdit,
    ],
  );

  const handleClearSkill = useCallback(() => {
    const nextDraft = skillDraft.body
      ? `${skillDraft.skillCommand} ${skillDraft.body}`
      : skillDraft.skillCommand;
    onDraftChange(nextDraft);
    inputRef.current?.focus();
  }, [inputRef, onDraftChange, skillDraft.body, skillDraft.skillCommand]);

  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (!promptHistoryNavigatingRef.current) {
        resetPromptHistoryNavigation();
      }

      const nextValue = event.target.value;

      if (skillDraft.hasSkill) {
        onDraftChange(
          nextValue ? `${skillDraft.skillCommand} ${nextValue}` : skillDraft.skillCommand,
        );
      } else {
        onDraftChange(nextValue);
      }

      setCaretIndex(event.target.selectionStart ?? 0);
      resizeComposerInput(event.target);
      syncComposerInputScroll();
    },
    [onDraftChange, resetPromptHistoryNavigation, skillDraft, syncComposerInputScroll],
  );

  const handleAttach = useCallback(async () => {
    const sourcePath = await window.nexus.dialog.openImage();

    if (!sourcePath) {
      return;
    }

    const dataUrl = await readImagePathAsDataUrl(sourcePath);

    if (!dataUrl) {
      return;
    }

    await attachImageWithMention(dataUrl);
  }, [attachImageWithMention]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;

      if (!items) {
        return;
      }

      const imageFiles: File[] = [];

      for (const item of items) {
        if (!item.type.startsWith('image/')) {
          continue;
        }

        const file = item.getAsFile();

        if (file) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();

      void (async () => {
        const dataUrls: string[] = [];

        for (const file of imageFiles) {
          try {
            dataUrls.push(await blobToDataUrl(file));
          } catch {
            continue;
          }
        }

        await attachMultipleImagesWithMentions(dataUrls);
      })();
    },
    [attachMultipleImagesWithMentions],
  );

  const pendingImages = useMemo(
    () =>
      images.map((image, index) => (
        <div key={image.id} className='agent-view__paste-image'>
          <AgentPromptImageIndexBadge index={index + 1} />
          <button
            type='button'
            className='agent-view__paste-image-thumb-btn app-button'
            onClick={() => setPreviewUrl(image.dataUrl)}
          >
            <img src={image.dataUrl} alt='' className='agent-view__paste-image-thumb' />
          </button>
          <button
            type='button'
            className='agent-view__paste-image-remove app-button app-button--enter'
            aria-label={`Remover ${image.label}`}
            onClick={() => removeImage(paneId, image.id)}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      )),
    [images, paneId, removeImage],
  );

  return (
    <>
      <div className={`agent-view__composer${isEditing ? ' agent-view__composer--editing' : ''}`}>
        {isEditing ? (
          <div className='agent-view__composer-edit-bar app-button--enter'>
            <div className='agent-view__composer-edit-bar-main'>
              <Pencil size={14} strokeWidth={2} aria-hidden='true' />
              <span className='agent-view__composer-edit-bar-title'>Editando mensagem</span>
            </div>
            <button
              type='button'
              className='agent-view__composer-edit-cancel app-button app-button--enter'
              onClick={onCancelEdit}
            >
              Cancelar
            </button>
          </div>
        ) : null}
        <div
          ref={composerCardRef}
          className={`agent-view__composer-card${isEditing ? ' agent-view__composer-card--editing' : ''}${composerDropActive ? ' agent-view__composer-card--drop-target' : ''}`}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
        >
          {pendingImages.length > 0 ? (
            <div className='agent-view__composer-attachments'>{pendingImages}</div>
          ) : null}
          <div
            className={`agent-view__composer-input-row${skillDraft.hasSkill ? ' agent-view__composer-input-row--with-skill' : ''}`}
          >
            {skillDraft.hasSkill ? (
              <div className='agent-view__composer-skill-badge app-button--enter'>
                <div className='agent-view__user-skill agent-view__user-skill--skill'>
                  <BookOpen size={11} strokeWidth={2} aria-hidden='true' />
                  <span className='agent-view__user-skill-label'>{skillDraft.skillLabel}</span>
                </div>
                <button
                  type='button'
                  className='agent-view__composer-skill-clear app-button'
                  aria-label={`Remover skill ${skillDraft.skillLabel}`}
                  onClick={handleClearSkill}
                >
                  <X size={12} strokeWidth={2.25} aria-hidden='true' />
                </button>
              </div>
            ) : null}
            <div className='agent-view__composer-input-wrap'>
              <div
                ref={composerInputMirrorRef}
                className='agent-view__composer-input-mirror'
                aria-hidden='true'
              >
                {composerInputValue ? (
                  <AgentPromptImageMentionText text={composerInputValue} alignWidth />
                ) : (
                  <span className='agent-view__composer-input-mirror-placeholder'>
                    {inputPlaceholder}
                  </span>
                )}
              </div>
              <textarea
                ref={inputRef}
                className='agent-view__composer-input agent-view__composer-input--mirrored'
                value={composerInputValue}
                rows={1}
                placeholder={inputPlaceholder}
                disabled={interactionPending}
                spellCheck={false}
                onChange={handleDraftChange}
                onClick={syncCaretIndex}
                onKeyUp={syncCaretIndex}
                onSelect={syncCaretIndex}
                onScroll={syncComposerInputScroll}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
              />
            </div>
          </div>
          <div className='agent-view__composer-bar'>
            <div className='agent-view__composer-bar-left'>
              <AgentComposerPlusMenu
                paneId={paneId}
                cwd={projectPath}
                isVisible={isVisible}
                onRunCommand={onRunCommand}
                onAttachImage={() => void handleAttach()}
              />
              {activeMode !== 'agent' && activeModeOption ? (
                <AgentComposerModeChip
                  mode={activeMode}
                  option={activeModeOption}
                  onClear={handleClearMode}
                />
              ) : null}
              <AgentComposerModelSelect
                paneId={paneId}
                cwd={projectPath}
                isVisible={isVisible}
                onRunCommand={onRunCommand}
              />
              <AgentCursorUsageIndicator
                usage={cursorUsage}
                isLoading={cursorUsageLoading}
                visible={isVisible}
                onRefresh={() => void refreshCursorUsage(true)}
              />
              {showWaitingStatus ? (
                <AgentLiveStatus label={waitingLabel} />
              ) : null}
            </div>
            <div className='agent-view__composer-bar-actions'>
              <button
                type='button'
                className={`agent-view__composer-send app-button app-button--enter${canStop ? ' agent-view__composer-send--stop' : ''}${canSend || canStop ? ' agent-view__composer-send--ready' : ''}`}
                aria-label={canStop ? 'Parar agent' : isEditing ? 'Salvar edição' : 'Enviar prompt'}
                disabled={isActionDisabled}
                onClick={handleSubmit}
              >
                {canStop ? (
                  <Square size={13} strokeWidth={2.25} fill='currentColor' aria-hidden='true' />
                ) : (
                  <ArrowUp size={16} strokeWidth={2.25} aria-hidden='true' />
                )}
              </button>
              {showContextUsage ? (
                <AgentContextUsageIndicator
                  usage={contextUsage}
                  isLoading={contextUsageLoading}
                  visible={showContextUsage}
                  onRequestReport={onRequestContextUsageReport}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {mention.isOpen && getMentionAnchorRect()
        ? createPortal(
            <AgentComposerMentionMenu
              getAnchorRect={getMentionAnchorRect}
              matches={mention.matches}
              activeIndex={mention.activeIndex}
              isLoading={mention.isLoading}
              trigger={mention.mentionContext?.trigger ?? '@'}
              repositionToken={mentionRepositionToken}
              onClose={handleMentionClose}
              onSelect={handleMentionSelect}
            />,
            document.body,
          )
        : null}
      {previewUrl ? (
        <AnimatedModal panelClassName='terminal-paste-image-lightbox' onClose={() => setPreviewUrl(null)}>
          {(requestClose) => (
            <button
              type='button'
              className='terminal-paste-image-lightbox__close app-button'
              aria-label='Fechar imagem'
              onClick={requestClose}
            >
              <img
                src={previewUrl}
                alt=''
                className='terminal-paste-image-lightbox__image'
                draggable={false}
              />
            </button>
          )}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const AgentComposer = memo(AgentComposerComponent);

export async function handleAgentComposerDrop(
  projectPath: string,
  paneId: string,
  dataTransfer: DataTransfer,
): Promise<void> {
  let mentionDraft = '';

  if (isExternalFileDrag(dataTransfer)) {
    const dataUrls = await readDroppedImageDataUrls(dataTransfer);
    const imageNumbers: number[] = [];

    for (const dataUrl of dataUrls) {
      const attached = await attachAgentPromptImageToPane(projectPath, paneId, dataUrl, false);

      if (attached) {
        imageNumbers.push(attached.imageNumber);
      }
    }

    if (imageNumbers.length === 1) {
      mentionDraft = buildAgentPromptImageMentionAppendFragment('', imageNumbers[0]!);
    } else if (imageNumbers.length > 1) {
      mentionDraft = imageNumbers
        .map((n) => `${buildAgentPromptImageMention(n)} = `)
        .join('\n');
      mentionDraft = `${mentionDraft}\n`;
    }

    const pathMentions = await resolveAgentComposerDropMentions(projectPath, dataTransfer, {
      includeImages: false,
    });

    if (pathMentions.length > 0) {
      mentionDraft = `${mentionDraft}${buildAgentComposerMentionsAppendFragment(mentionDraft, pathMentions)}`;
    }
  } else {
    const pathMentions = await resolveAgentComposerDropMentions(projectPath, dataTransfer);

    if (pathMentions.length > 0) {
      mentionDraft = buildAgentComposerMentionsAppendFragment('', pathMentions);
    }
  }

  if (mentionDraft) {
    writeAgentPaneDraft(paneId, mentionDraft);
  }
}

export function appendAgentComposerDraft(paneId: string, text: string): void {
  writeAgentPaneDraft(paneId, text);
}
