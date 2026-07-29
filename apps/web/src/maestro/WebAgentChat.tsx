import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ArrowUp, AtSign, ChevronDown, ChevronRight, FileText, Globe, Paperclip, Square, X } from 'lucide-react';
import type { WebAgentSession, WebAgentTurn } from '../store';
import { renderWebMarkdown } from './webMarkdown';
import { hydrateWebMarkdownImages } from './webHydrateMarkdownImages';
import { findMarkdownPreviewImage } from './downloadImageSrc';
import { WebMarkdownImageLightbox } from './WebMarkdownImageLightbox';
import { WebAgentPlusMenu, type WebAgentMode } from './WebAgentPlusMenu';
import { WebAgentPromptImageMentionText } from './WebAgentPromptImageMentionText';
import {
  buildWebAgentPromptFileMentionInsertion,
  buildWebAgentPromptImageMentionInsertion,
  getWebAgentPromptImageBadgeColor,
  MAX_WEB_PROMPT_FILES,
  MAX_WEB_PROMPT_IMAGES,
  notifyRejectedAttachments,
  readAttachmentFiles,
  renumberWebAgentPromptImages,
  toWebFileAttachmentPayloads,
  WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX,
  type WebFileAttachmentPayload,
  type WebPendingAskFile,
  type WebPendingAskImage,
} from './webAgentPromptImages';

interface WebAgentChatProps {
  agent: WebAgentSession;
  onFollowUp: (
    agentId: string,
    prompt: string,
    imageDataUrls?: string[],
    fileAttachments?: WebFileAttachmentPayload[],
  ) => boolean | Promise<boolean>;
  onStop: (agentId: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onModeChange: (agentId: string, modeId: WebAgentMode) => void;
}

const WEB_AGENT_MODELS = [
  { value: 'auto', label: 'Auto' },
  { value: 'composer-2', label: 'Composer 2' },
  { value: 'composer-2-fast', label: 'Composer 2 Fast' },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet' },
  { value: 'claude-4.6-sonnet-medium-thinking', label: 'Claude 4.6 Sonnet' },
] as const;

function formatThoughtDuration(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

function ThoughtBlock({
  streaming,
  startedAt,
  endedAt,
  body,
}: {
  streaming: boolean;
  startedAt: number;
  endedAt?: number;
  body: string;
}) {
  const [expanded, setExpanded] = useState(streaming || !body);
  const [elapsed, setElapsed] = useState(1);

  useEffect(() => {
    if (!streaming) {
      return;
    }
    const tick = () => {
      setElapsed(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, streaming]);

  useEffect(() => {
    setExpanded(streaming);
  }, [streaming]);

  const title = streaming
    ? `Thinking ${elapsed}s`
    : `Thought for ${formatThoughtDuration((endedAt ?? Date.now()) - startedAt)}`;

  const waitingHint =
    streaming && !body.trim()
      ? elapsed >= 300
        ? 'Demorando demais. Se continuar assim, pare o agent e tente de novo.'
        : elapsed >= 90
          ? 'Ainda sem resposta do agent neste Mac...'
          : null
      : null;

  return (
    <div
      className={`agent-view__thought${streaming ? ' agent-view__thought--streaming' : ''}${
        expanded ? ' agent-view__thought--expanded' : ''
      }`}
    >
      <button
        type='button'
        className='agent-view__thought-header app-button'
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span
          className={`agent-view__thought-title${
            streaming ? ' agent-view__thought-title--streaming' : ''
          }`}
        >
          {title}
        </span>
      </button>
      {expanded ? (
        <div className='agent-view__thought-body'>
          {body.trim() ? <div className='agent-view__thought-prose'>{body}</div> : null}
          {streaming && !body.trim() ? (
            <div className='agent-view__thought-waiting'>
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              {waitingHint ? (
                <span className='agent-view__thought-waiting-hint'>{waitingHint}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function findWebResponseInlineCode(element: EventTarget | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const code = element.closest('code');

  if (!code || code.classList.contains('hljs') || code.closest('pre')) {
    return null;
  }

  return code;
}

function ResponseBody({
  text,
  streaming,
  deviceId,
  projectId,
}: {
  text: string;
  streaming: boolean;
  deviceId: string | null;
  projectId: string | null;
}) {
  const rendered = useMemo(() => renderWebMarkdown(text), [text]);
  const [html, setHtml] = useState(rendered);
  const copiedTimeoutRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ src: string; fileName: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(rendered);

    void hydrateWebMarkdownImages(rendered, { deviceId, projectId }).then((hydrated) => {
      if (!cancelled) {
        setHtml(hydrated);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rendered, deviceId, projectId]);

  const handleClick = useCallback(async (event: ReactMouseEvent<HTMLDivElement>) => {
    const image = findMarkdownPreviewImage(event.target);

    if (image) {
      event.preventDefault();
      event.stopPropagation();
      setPreview({
        src: image.currentSrc || image.src,
        fileName:
          image.getAttribute('data-image-ref') ||
          image.getAttribute('data-image-path') ||
          image.getAttribute('alt') ||
          null,
      });
      return;
    }

    const code = findWebResponseInlineCode(event.target);

    if (!code) {
      return;
    }

    const value = code.textContent?.trim() ?? '';

    if (!value) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(value);

      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }

      code.classList.add('markdown-preview__inline-code--copied');
      code.setAttribute('title', 'Copiado');

      copiedTimeoutRef.current = window.setTimeout(() => {
        code.classList.remove('markdown-preview__inline-code--copied');
        code.removeAttribute('title');
        copiedTimeoutRef.current = null;
      }, 1600);
    } catch {
      code.classList.remove('markdown-preview__inline-code--copied');
      code.removeAttribute('title');
    }
  }, []);

  return (
    <div
      className={`agent-view__response${
        streaming ? ' agent-view__response--streaming' : ' agent-view__response--settled'
      }`}
    >
      <div
        className='agent-view__response-body markdown-preview'
        onClick={(event) => void handleClick(event)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {preview ? (
        <WebMarkdownImageLightbox
          src={preview.src}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

function TurnView({
  turn,
  deviceId,
  projectId,
}: {
  turn: WebAgentTurn;
  deviceId: string | null;
  projectId: string | null;
}) {
  const multiline = turn.prompt.includes('\n') || turn.prompt.length > 72;
  const running = turn.status === 'running';
  const showThought =
    running || Boolean(turn.thought) || Boolean(turn.response) || turn.status === 'error';
  const thoughtStreaming = running && (turn.thoughtStreaming || !turn.response.trim());
  const responseStreaming = running && Boolean(turn.response.trim());

  return (
    <div className='agent-view__turn app-button--enter'>
      <div className='agent-view__user-prompt'>
        <div
          className={`agent-view__user-bubble${
            multiline ? ' agent-view__user-bubble--multiline' : ''
          }`}
        >
          {turn.prompt}
        </div>
      </div>
      {showThought ? (
        <ThoughtBlock
          streaming={thoughtStreaming}
          startedAt={turn.createdAt}
          endedAt={turn.endedAt}
          body={turn.thought}
        />
      ) : null}
      {turn.status === 'error' ? (
        <div className='agent-view__response agent-view__response--settled'>
          <div className='agent-view__response-body web-agent-error'>
            {turn.response.trim() || 'Falha ao executar o agent neste Mac.'}
          </div>
        </div>
      ) : turn.response.trim() ? (
        <ResponseBody
          text={turn.response}
          streaming={responseStreaming}
          deviceId={deviceId}
          projectId={projectId}
        />
      ) : null}
    </div>
  );
}

export function WebAgentChat({
  agent,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
}: WebAgentChatProps) {
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState<WebPendingAskImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<WebPendingAskFile[]>([]);
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewImageName, setPreviewImageName] = useState('imagem.png');
  const followUpInFlightRef = useRef(false);
  const draftRef = useRef(draft);
  const pendingImagesRef = useRef(pendingImages);
  const pendingFilesRef = useRef(pendingFiles);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const askFormRef = useRef<HTMLFormElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const accent = agent.projectColor || '#8b5cf6';
  const attachDisabled = sendingFollowUp;
  const canStop =
    agent.status === 'running' &&
    !draft.trim() &&
    pendingImages.length === 0 &&
    pendingFiles.length === 0 &&
    !sendingFollowUp;
  const canSend =
    (Boolean(draft.trim()) || pendingImages.length > 0 || pendingFiles.length > 0) &&
    !canStop &&
    !sendingFollowUp;
  const modelId = agent.modelId || 'auto';
  const modeId = agent.modeId || 'agent';
  const modelList = useMemo(
    () => WEB_AGENT_MODELS.map((item) => ({ value: item.value, label: item.label })),
    [],
  );

  draftRef.current = draft;
  pendingImagesRef.current = pendingImages;
  pendingFilesRef.current = pendingFiles;

  const imagePreviewByNumber = useMemo(() => {
    const map = new Map<number, string>();
    pendingImages.forEach((image, index) => {
      map.set(index + 1, image.dataUrl);
    });
    return map;
  }, [pendingImages]);

  const turns = useMemo(() => (agent.turns.length > 0 ? agent.turns : []), [agent.turns]);
  const stickToBottomRef = useRef(true);
  const lastTurnIdRef = useRef<string | null>(null);

  const resizeComposerInput = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, []);

  const setDraftWithCaret = useCallback(
    (nextDraft: string, nextCaret: number) => {
      setDraft(nextDraft);
      draftRef.current = nextDraft;
      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) {
          return;
        }
        input.focus();
        input.setSelectionRange(nextCaret, nextCaret);
        resizeComposerInput(input);
      });
    },
    [resizeComposerInput],
  );

  const attachImagesWithMentions = useCallback(
    (dataUrls: string[]) => {
      if (dataUrls.length === 0) {
        return;
      }

      const remainingSlots = MAX_WEB_PROMPT_IMAGES - pendingImagesRef.current.length;
      if (remainingSlots <= 0) {
        window.alert(`Máximo de ${MAX_WEB_PROMPT_IMAGES} imagens por mensagem.`);
        return;
      }

      const limited = dataUrls.slice(0, remainingSlots);
      const selectionStart = inputRef.current?.selectionStart ?? draftRef.current.length;
      let nextDraft = draftRef.current;
      let nextCaret = selectionStart;
      const merged = [...pendingImagesRef.current];

      for (const dataUrl of limited) {
        const imageNumber = merged.length + 1;
        const insertion = buildWebAgentPromptImageMentionInsertion(
          nextDraft,
          nextCaret,
          nextCaret,
          imageNumber,
        );
        nextDraft = insertion.nextDraft;
        nextCaret = insertion.nextCaret;
        merged.push({
          id: `${Date.now()}-${imageNumber}-${Math.random().toString(36).slice(2, 7)}`,
          dataUrl,
        });
      }

      pendingImagesRef.current = merged;
      setPendingImages(merged);
      setDraftWithCaret(nextDraft, nextCaret);
    },
    [setDraftWithCaret],
  );

  const attachFilesWithMentions = useCallback(
    (files: WebPendingAskFile[]) => {
      if (files.length === 0) {
        return;
      }

      const remainingSlots = MAX_WEB_PROMPT_FILES - pendingFilesRef.current.length;
      if (remainingSlots <= 0) {
        window.alert(`Máximo de ${MAX_WEB_PROMPT_FILES} arquivos por mensagem.`);
        return;
      }

      const limited = files.slice(0, remainingSlots);
      const selectionStart = inputRef.current?.selectionStart ?? draftRef.current.length;
      let nextDraft = draftRef.current;
      let nextCaret = selectionStart;
      const merged = [...pendingFilesRef.current, ...limited];

      for (const file of limited) {
        const insertion = buildWebAgentPromptFileMentionInsertion(
          nextDraft,
          nextCaret,
          nextCaret,
          file.name,
        );
        nextDraft = insertion.nextDraft;
        nextCaret = insertion.nextCaret;
      }

      pendingFilesRef.current = merged;
      setPendingFiles(merged);
      setDraftWithCaret(nextDraft, nextCaret);
    },
    [setDraftWithCaret],
  );

  const ingestFiles = useCallback(
    async (fileList: Iterable<File>) => {
      const { imageDataUrls, fileAttachments, rejectedNames } =
        await readAttachmentFiles(fileList);
      notifyRejectedAttachments(rejectedNames);
      attachImagesWithMentions(imageDataUrls);
      attachFilesWithMentions(fileAttachments);
    },
    [attachFilesWithMentions, attachImagesWithMentions],
  );

  const removePendingImage = useCallback(
    (imageId: string) => {
      const images = pendingImagesRef.current;
      const index = images.findIndex((image) => image.id === imageId);
      if (index < 0) {
        return;
      }

      const kept = images.filter((image) => image.id !== imageId);
      const mentionPattern = new RegExp(
        WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.source,
        WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.flags,
      );
      const nextDraft = draftRef.current
        .replace(mentionPattern, (full, rawNumber: string) => {
          const oldNumber = Number.parseInt(rawNumber, 10);
          if (!Number.isFinite(oldNumber) || oldNumber <= 0) {
            return full;
          }
          if (oldNumber === index + 1) {
            return '';
          }
          if (oldNumber > index + 1) {
            return `(img ${oldNumber - 1})`;
          }
          return `(img ${oldNumber})`;
        })
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n');

      pendingImagesRef.current = kept;
      setPendingImages(kept);
      draftRef.current = nextDraft;
      setDraft(nextDraft);

      if (previewImageSrc && images[index]?.dataUrl === previewImageSrc) {
        setPreviewImageSrc(null);
      }

      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) {
          return;
        }
        resizeComposerInput(input);
      });
    },
    [previewImageSrc, resizeComposerInput],
  );

  const removePendingFile = useCallback(
    (fileId: string) => {
      const files = pendingFilesRef.current;
      const target = files.find((file) => file.id === fileId);
      if (!target) {
        return;
      }

      const kept = files.filter((file) => file.id !== fileId);
      const escaped = target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mentionPattern = new RegExp(`@${escaped}(?=\\s|$|[\\n])`);
      const nextDraft = draftRef.current
        .replace(mentionPattern, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n');

      pendingFilesRef.current = kept;
      setPendingFiles(kept);
      draftRef.current = nextDraft;
      setDraft(nextDraft);

      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) {
          return;
        }
        resizeComposerInput(input);
      });
    },
    [resizeComposerInput],
  );

  useEffect(() => {
    const { prompt: nextDraft, pendingImages: nextImages } = renumberWebAgentPromptImages(
      draft,
      pendingImagesRef.current,
    );

    if (nextImages !== pendingImagesRef.current) {
      pendingImagesRef.current = nextImages;
      setPendingImages(nextImages);
    }

    if (nextDraft !== draft) {
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    }
  }, [draft]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) {
      return;
    }

    const atBottom = () =>
      node.scrollHeight - node.scrollTop - node.clientHeight <= 48;

    const handleScroll = () => {
      stickToBottomRef.current = atBottom();
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0) {
        return;
      }

      window.requestAnimationFrame(() => {
        if (!atBottom()) {
          stickToBottomRef.current = false;
        }
      });
    };

    node.addEventListener('scroll', handleScroll, { passive: true });
    node.addEventListener('wheel', handleWheel, { passive: true });

    const content = node.firstElementChild;
    const observer =
      content instanceof HTMLElement
        ? new ResizeObserver(() => {
            if (!stickToBottomRef.current) {
              return;
            }
            node.scrollTop = node.scrollHeight;
          })
        : null;
    if (content instanceof HTMLElement && observer) {
      observer.observe(content);
    }

    return () => {
      node.removeEventListener('scroll', handleScroll);
      node.removeEventListener('wheel', handleWheel);
      observer?.disconnect();
    };
  }, [agent.id]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) {
      return;
    }

    const lastTurnId = turns[turns.length - 1]?.id ?? null;
    const previousTurnId = lastTurnIdRef.current;
    lastTurnIdRef.current = lastTurnId;

    if (lastTurnId && previousTurnId !== lastTurnId) {
      stickToBottomRef.current = true;
    }

    if (!stickToBottomRef.current) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [agent.turns, turns]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canStop) {
      onStop(agent.id);
      return;
    }
    if (followUpInFlightRef.current || sendingFollowUp) {
      return;
    }
    const text = draft.trim();
    const imageDataUrls = pendingImages.map((image) => image.dataUrl);
    const fileAttachments = toWebFileAttachmentPayloads(pendingFiles);
    if (!text && imageDataUrls.length === 0 && fileAttachments.length === 0) {
      return;
    }

    let nextPrompt = text;
    if (!nextPrompt && (imageDataUrls.length > 0 || fileAttachments.length > 0)) {
      const parts: string[] = [];
      if (imageDataUrls.length > 0) {
        parts.push(...pendingImages.map((_, index) => `(img ${index + 1})`));
      }
      if (fileAttachments.length > 0) {
        parts.push(...pendingFiles.map((file) => `@${file.name}`));
      }
      nextPrompt = parts.join(' ');
    }

    const snapshot = {
      draft,
      pendingImages,
      pendingFiles,
    };
    followUpInFlightRef.current = true;
    setSendingFollowUp(true);
    setDraft('');
    setPendingImages([]);
    setPendingFiles([]);
    setPreviewImageSrc(null);
    draftRef.current = '';
    pendingImagesRef.current = [];
    pendingFilesRef.current = [];
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    void Promise.resolve(onFollowUp(agent.id, nextPrompt, imageDataUrls, fileAttachments))
      .then((ok) => {
        if (
          ok === false &&
          draftRef.current === '' &&
          pendingImagesRef.current.length === 0 &&
          pendingFilesRef.current.length === 0
        ) {
          draftRef.current = snapshot.draft;
          pendingImagesRef.current = snapshot.pendingImages;
          pendingFilesRef.current = snapshot.pendingFiles;
          setDraft(snapshot.draft);
          setPendingImages(snapshot.pendingImages);
          setPendingFiles(snapshot.pendingFiles);
        }
      })
      .catch(() => {
        if (
          draftRef.current === '' &&
          pendingImagesRef.current.length === 0 &&
          pendingFilesRef.current.length === 0
        ) {
          draftRef.current = snapshot.draft;
          pendingImagesRef.current = snapshot.pendingImages;
          pendingFilesRef.current = snapshot.pendingFiles;
          setDraft(snapshot.draft);
          setPendingImages(snapshot.pendingImages);
          setPendingFiles(snapshot.pendingFiles);
        }
      })
      .finally(() => {
        followUpInFlightRef.current = false;
        setSendingFollowUp(false);
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (attachDisabled) {
        return;
      }

      const clipboard = event.clipboardData;
      if (!clipboard) {
        return;
      }

      const files: File[] = [];
      for (const item of clipboard.items) {
        if (!item.type.startsWith('image/') && !item.type.startsWith('video/')) {
          continue;
        }
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }

      if (files.length === 0) {
        for (const file of clipboard.files) {
          if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
            files.push(file);
          }
        }
      }

      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      void ingestFiles(files);
    },
    [attachDisabled, ingestFiles],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (attachDisabled) {
        return;
      }
      if (![...event.dataTransfer.types].includes('Files')) {
        return;
      }
      event.preventDefault();
      setDropActive(true);
    },
    [attachDisabled],
  );

  const handleDragLeave = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    const related = event.relatedTarget as Node | null;
    if (!askFormRef.current?.contains(related)) {
      setDropActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDropActive(false);
      if (attachDisabled) {
        return;
      }
      void ingestFiles(event.dataTransfer.files).then(() => {
        inputRef.current?.focus();
      });
    },
    [attachDisabled, ingestFiles],
  );

  const handleAttachImage = useCallback(() => {
    if (attachDisabled) {
      return;
    }
    imageInputRef.current?.click();
  }, [attachDisabled]);

  const handleAttachFile = useCallback(() => {
    if (attachDisabled) {
      return;
    }
    fileInputRef.current?.click();
  }, [attachDisabled]);

  const handleImageInputChange = useCallback(() => {
    const input = imageInputRef.current;
    if (!input?.files || input.files.length === 0) {
      return;
    }
    void ingestFiles(input.files).then(() => {
      input.value = '';
      inputRef.current?.focus();
    });
  }, [ingestFiles]);

  const handleFileInputChange = useCallback(() => {
    const input = fileInputRef.current;
    if (!input?.files || input.files.length === 0) {
      return;
    }
    void ingestFiles(input.files).then(() => {
      input.value = '';
      inputRef.current?.focus();
    });
  }, [ingestFiles]);

  return (
    <div className='agent-view web-agent-view' style={{ ['--agent-accent' as string]: accent }}>
      <div className='agent-view__transcript-shell'>
        <div className='agent-view__transcript' ref={transcriptRef}>
          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              deviceId={agent.deviceId}
              projectId={agent.projectId}
            />
          ))}
        </div>
      </div>
      <div className={`agent-view__footer${turns.length === 0 ? ' agent-view__footer--idle' : ''}`}>
        <form
          ref={askFormRef}
          className={`home-dashboard__ask agent-view__ask app-button--enter${
            dropActive ? ' home-dashboard__ask--drop-target' : ''
          }`}
          onSubmit={submit}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={imageInputRef}
            type='file'
            accept='image/png,image/jpeg,image/jpg,image/webp,image/gif'
            multiple
            hidden
            onChange={handleImageInputChange}
          />
          <input
            ref={fileInputRef}
            type='file'
            multiple
            hidden
            onChange={handleFileInputChange}
          />
          {pendingImages.length > 0 || pendingFiles.length > 0 ? (
            <div
              className='home-dashboard__ask-attachments app-button--enter'
              aria-label='Anexos'
            >
              {pendingImages.map((image, index) => {
                const imageNumber = index + 1;
                const badgeColor = getWebAgentPromptImageBadgeColor(imageNumber);
                return (
                  <div key={image.id} className='home-dashboard__ask-attachment app-button--enter'>
                    <span
                      className='home-dashboard__ask-attachment-index'
                      style={{ '--prompt-image-badge-color': badgeColor } as CSSProperties}
                      aria-hidden='true'
                    >
                      {imageNumber}
                    </span>
                    <button
                      type='button'
                      className='home-dashboard__ask-attachment-thumb-btn app-button'
                      aria-label={`Ver imagem ${imageNumber}`}
                      disabled={attachDisabled}
                      onClick={() => {
                        setPreviewImageSrc(image.dataUrl);
                        setPreviewImageName(`imagem-${imageNumber}.png`);
                      }}
                    >
                      <img
                        src={image.dataUrl}
                        alt=''
                        className='home-dashboard__ask-attachment-thumb'
                        draggable={false}
                      />
                    </button>
                    <button
                      type='button'
                      className='home-dashboard__ask-attachment-remove app-button app-button--enter'
                      aria-label={`Remover imagem ${imageNumber}`}
                      disabled={attachDisabled}
                      onClick={() => removePendingImage(image.id)}
                    >
                      <X size={12} strokeWidth={2.5} aria-hidden='true' />
                    </button>
                  </div>
                );
              })}
              {pendingFiles.map((file) => (
                <div key={file.id} className='web-agent-file-chip app-button--enter'>
                  <FileText size={14} strokeWidth={2} aria-hidden='true' />
                  <span className='web-agent-file-chip__name' title={file.name}>
                    {file.name}
                  </span>
                  <button
                    type='button'
                    className='web-agent-file-chip__remove app-button'
                    aria-label={`Remover ${file.name}`}
                    disabled={attachDisabled}
                    onClick={() => removePendingFile(file.id)}
                  >
                    <X size={12} strokeWidth={2.5} aria-hidden='true' />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className='home-dashboard__ask-selects'>
            <WebAgentPlusMenu
              mode={modeId}
              modelId={modelId}
              models={modelList}
              attachDisabled={attachDisabled}
              onModeChange={(next) => onModeChange(agent.id, next)}
              onModelChange={(next) => onModelChange(agent.id, next)}
              onAttachImage={handleAttachImage}
              onAttachFile={handleAttachFile}
            />
          </div>
          <div className='home-dashboard__ask-main'>
            <div className='home-dashboard__ask-input-wrap'>
              <div className='home-dashboard__ask-input-mirror' aria-hidden='true'>
                {draft ? (
                  <WebAgentPromptImageMentionText
                    text={draft}
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
                value={draft}
                rows={1}
                placeholder='Pergunte algo ao Nexus...'
                spellCheck={false}
                disabled={sendingFollowUp}
                aria-label='Pergunte algo ao Nexus'
                onChange={(event) => {
                  setDraft(event.target.value);
                  resizeComposerInput(event.target);
                }}
                onKeyDown={onKeyDown}
                onPaste={handlePaste}
              />
            </div>
          </div>
          <div className='home-dashboard__ask-actions'>
            <button
              type='button'
              className='home-dashboard__ask-action app-button'
              aria-label='Anexar'
              disabled={attachDisabled}
              title='Anexar'
              onClick={handleAttachImage}
            >
              <Paperclip size={16} strokeWidth={2} aria-hidden='true' />
            </button>
            <button
              type='button'
              className='home-dashboard__ask-action app-button'
              aria-label='Mencionar arquivo'
              disabled
              title='Em breve'
            >
              <AtSign size={16} strokeWidth={2} aria-hidden='true' />
            </button>
            <button
              type='button'
              className='home-dashboard__ask-action app-button'
              aria-label='Pesquisar na web'
              disabled
              title='Em breve'
            >
              <Globe size={16} strokeWidth={2} aria-hidden='true' />
            </button>
            <button
              type={canStop ? 'button' : 'submit'}
              className={`home-dashboard__ask-send app-button app-button--enter${
                canStop ? ' home-dashboard__ask-send--stop' : ''
              }`}
              aria-label={canStop ? 'Parar agent' : 'Enviar'}
              disabled={!canSend && !canStop}
              onClick={
                canStop
                  ? (event) => {
                      event.preventDefault();
                      onStop(agent.id);
                    }
                  : undefined
              }
            >
              {canStop ? (
                <Square size={13} strokeWidth={2.25} fill='currentColor' aria-hidden='true' />
              ) : (
                <ArrowUp size={16} strokeWidth={2.25} aria-hidden='true' />
              )}
            </button>
          </div>
        </form>
      </div>
      {previewImageSrc ? (
        <WebMarkdownImageLightbox
          src={previewImageSrc}
          fileName={previewImageName}
          onClose={() => setPreviewImageSrc(null)}
        />
      ) : null}
    </div>
  );
}
