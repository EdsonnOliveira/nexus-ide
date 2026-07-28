import {
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
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, AtSign, Bot, FileText, FolderKanban, Globe, Image, Paperclip, X } from 'lucide-react';
import type { CloudProject, DeviceRecord } from '@nexus/protocol';
import type { WebAgentSession } from '../store';
import { WebAskMenuSelect } from './WebAskMenuSelect';
import { WebMacSelect } from './WebMacSelect';
import { WebAgentPromptImageMentionText } from './WebAgentPromptImageMentionText';
import { WebMarkdownImageLightbox } from './WebMarkdownImageLightbox';
import {
  buildWebAgentPromptFileMentionInsertion,
  buildWebAgentPromptImageMention,
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

interface WebMaestroAskBarProps {
  projects: CloudProject[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  devices: DeviceRecord[];
  deviceId: string | null;
  onDeviceChange: (deviceId: string | null) => void;
  submitting: boolean;
  onSubmit: (
    prompt: string,
    imageDataUrls?: string[],
    fileAttachments?: WebFileAttachmentPayload[],
  ) => boolean | Promise<boolean>;
  desktopAgents: WebAgentSession[];
  onSelectAgent: (agentId: string) => void;
  onRequestDesktopAgents: () => void | Promise<void>;
  hideProjectSelect?: boolean;
}

function ProjectLeading({
  logoUrl,
  color,
  icon,
}: {
  logoUrl: string | null;
  color: string | null;
  icon: string | null;
}) {
  if (logoUrl) {
    return <img src={logoUrl} alt='' className='home-dashboard__ask-project-logo' />;
  }
  return (
    <span
      className='home-dashboard__ask-project-icon'
      style={
        color
          ? { background: color }
          : { background: 'rgba(255,255,255,0.08)', color: '#fff' }
      }
    >
      {icon ? (
        <span className='web-ask-project-letter'>{icon.slice(0, 1)}</span>
      ) : (
        <FolderKanban size={12} />
      )}
    </span>
  );
}

export function WebMaestroAskBar({
  projects,
  projectId,
  onProjectChange,
  devices,
  deviceId,
  onDeviceChange,
  submitting,
  onSubmit,
  desktopAgents,
  onSelectAgent,
  onRequestDesktopAgents,
  hideProjectSelect = false,
}: WebMaestroAskBarProps) {
  const [prompt, setPrompt] = useState('');
  const [pendingImages, setPendingImages] = useState<WebPendingAskImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<WebPendingAskFile[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachMenuPhase, setAttachMenuPhase] = useState<'in' | 'out'>('in');
  const [attachMenuRect, setAttachMenuRect] = useState<DOMRect | null>(null);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewImageName, setPreviewImageName] = useState('imagem.png');
  const [desktopAgentsPhase, setDesktopAgentsPhase] = useState<'closed' | 'in' | 'out'>('closed');
  const [desktopAgentsLoading, setDesktopAgentsLoading] = useState(false);
  const [desktopAgentsMenuRect, setDesktopAgentsMenuRect] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
    openUp: boolean;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askFormRef = useRef<HTMLFormElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const desktopAgentsTriggerRef = useRef<HTMLButtonElement>(null);
  const desktopAgentsMenuRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef(prompt);
  const pendingImagesRef = useRef(pendingImages);
  const pendingFilesRef = useRef(pendingFiles);
  const submitInFlightRef = useRef(false);

  promptRef.current = prompt;
  pendingImagesRef.current = pendingImages;
  pendingFilesRef.current = pendingFiles;

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const canSubmit =
    (prompt.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0) &&
    !submitting &&
    Boolean(selectedProject);
  const imageActionsDisabled = submitting;

  const imagePreviewByNumber = useMemo(() => {
    const map = new Map<number, string>();
    pendingImages.forEach((image, index) => {
      map.set(index + 1, image.dataUrl);
    });
    return map;
  }, [pendingImages]);

  const handlePreviewImage = useCallback((src: string, fileName = 'imagem.png') => {
    setPreviewImageSrc(src);
    setPreviewImageName(fileName);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewImageSrc(null);
  }, []);

  const resizeAskInput = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 96)}px`;
  }, []);

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
            return buildWebAgentPromptImageMention(oldNumber - 1);
          }
          return buildWebAgentPromptImageMention(oldNumber);
        })
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n');

      pendingImagesRef.current = kept;
      setPendingImages(kept);
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);

      if (previewImageSrc && images[index]?.dataUrl === previewImageSrc) {
        setPreviewImageSrc(null);
      }

      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) {
          return;
        }
        resizeAskInput(input);
      });
    },
    [previewImageSrc, resizeAskInput],
  );

  const setPromptWithCaret = useCallback(
    (nextPrompt: string, nextCaret: number) => {
      setPrompt(nextPrompt);
      promptRef.current = nextPrompt;
      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) {
          return;
        }
        input.focus();
        input.setSelectionRange(nextCaret, nextCaret);
        resizeAskInput(input);
      });
    },
    [resizeAskInput],
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
      const selectionStart = inputRef.current?.selectionStart ?? promptRef.current.length;
      let nextPrompt = promptRef.current;
      let nextCaret = selectionStart;
      const merged = [...pendingImagesRef.current];

      for (const dataUrl of limited) {
        const imageNumber = merged.length + 1;
        const insertion = buildWebAgentPromptImageMentionInsertion(
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
      setPendingImages(merged);
      setPromptWithCaret(nextPrompt, nextCaret);
    },
    [setPromptWithCaret],
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
      const selectionStart = inputRef.current?.selectionStart ?? promptRef.current.length;
      let nextPrompt = promptRef.current;
      let nextCaret = selectionStart;
      const merged = [...pendingFilesRef.current, ...limited];

      for (const file of limited) {
        const insertion = buildWebAgentPromptFileMentionInsertion(
          nextPrompt,
          nextCaret,
          nextCaret,
          file.name,
        );
        nextPrompt = insertion.nextDraft;
        nextCaret = insertion.nextCaret;
      }

      pendingFilesRef.current = merged;
      setPendingFiles(merged);
      setPromptWithCaret(nextPrompt, nextCaret);
    },
    [setPromptWithCaret],
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
      const nextPrompt = promptRef.current
        .replace(mentionPattern, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n');

      pendingFilesRef.current = kept;
      setPendingFiles(kept);
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);

      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) {
          return;
        }
        resizeAskInput(input);
      });
    },
    [resizeAskInput],
  );

  const closeAttachMenu = useCallback(() => {
    setAttachMenuPhase('out');
  }, []);

  const openAttachMenu = useCallback(() => {
    if (imageActionsDisabled) {
      return;
    }
    const rect = attachTriggerRef.current?.getBoundingClientRect() ?? null;
    if (!rect) {
      return;
    }
    setAttachMenuRect(rect);
    setAttachMenuPhase('in');
    setAttachMenuOpen(true);
  }, [imageActionsDisabled]);

  useEffect(() => {
    if (!attachMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        attachTriggerRef.current?.contains(target) ||
        attachMenuRef.current?.contains(target)
      ) {
        return;
      }
      closeAttachMenu();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAttachMenu();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [attachMenuOpen, closeAttachMenu]);

  const syncAskBarHeight = useCallback(() => {
    const form = askFormRef.current;
    if (!form) {
      return;
    }
    document.documentElement.style.setProperty(
      '--web-ask-bar-height',
      `${Math.ceil(form.getBoundingClientRect().height)}px`,
    );
  }, []);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.name,
        leading: (
          <ProjectLeading
            logoUrl={project.logo_url}
            color={project.color}
            icon={project.icon}
          />
        ),
      })),
    [projects],
  );

  const desktopAgentsForProject = useMemo(
    () =>
      desktopAgents.filter(
        (agent) => Boolean(projectId) && agent.projectId === projectId,
      ),
    [desktopAgents, projectId],
  );

  const updateDesktopAgentsMenuPosition = useCallback(() => {
    const trigger = desktopAgentsTriggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const spaceAbove = rect.top - gap;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceAbove >= spaceBelow || spaceBelow < 220;
    const maxHeight = Math.min(280, Math.max(140, openUp ? spaceAbove : spaceBelow));
    const width = 300;
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }
    setDesktopAgentsMenuRect(
      openUp
        ? {
            left,
            bottom: window.innerHeight - rect.top + gap,
            maxHeight,
            openUp: true,
          }
        : {
            left,
            top: rect.bottom + gap,
            maxHeight,
            openUp: false,
          },
    );
  }, []);

  const closeDesktopAgentsMenu = useCallback(() => {
    setDesktopAgentsPhase((current) => (current === 'closed' ? current : 'out'));
  }, []);

  const openDesktopAgentsMenu = useCallback(async () => {
    const trigger = desktopAgentsTriggerRef.current;
    if (!trigger || !projectId || submitting) {
      return;
    }
    updateDesktopAgentsMenuPosition();
    setDesktopAgentsPhase('in');
    setDesktopAgentsLoading(true);
    try {
      await onRequestDesktopAgents();
    } finally {
      setDesktopAgentsLoading(false);
      updateDesktopAgentsMenuPosition();
    }
  }, [onRequestDesktopAgents, projectId, submitting, updateDesktopAgentsMenuPosition]);

  useEffect(() => {
    if (desktopAgentsPhase !== 'in') {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        desktopAgentsTriggerRef.current?.contains(target) ||
        desktopAgentsMenuRef.current?.contains(target)
      ) {
        return;
      }
      closeDesktopAgentsMenu();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDesktopAgentsMenu();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeDesktopAgentsMenu, desktopAgentsPhase]);

  useLayoutEffect(() => {
    if (desktopAgentsPhase === 'closed') {
      return;
    }
    updateDesktopAgentsMenuPosition();
    const sync = () => updateDesktopAgentsMenuPosition();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [desktopAgentsPhase, desktopAgentsForProject.length, desktopAgentsLoading, updateDesktopAgentsMenuPosition]);

  useEffect(() => {
    const { prompt: nextPrompt, pendingImages: nextImages } = renumberWebAgentPromptImages(
      prompt,
      pendingImagesRef.current,
    );

    if (nextImages !== pendingImagesRef.current) {
      pendingImagesRef.current = nextImages;
      setPendingImages(nextImages);
    }

    if (nextPrompt !== prompt) {
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
    }
  }, [prompt]);

  useLayoutEffect(() => {
    syncAskBarHeight();

    const form = askFormRef.current;
    const resizeObserver =
      form && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            syncAskBarHeight();
          })
        : null;

    if (form && resizeObserver) {
      resizeObserver.observe(form);
    }

    window.addEventListener('resize', syncAskBarHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncAskBarHeight);
    };
  }, [syncAskBarHeight, prompt, pendingImages.length, pendingFiles.length]);

  const submitPrompt = useCallback(() => {
    if (!canSubmit || submitInFlightRef.current) {
      return;
    }

    const trimmed = prompt.trim();
    const imageDataUrls = pendingImages.map((image) => image.dataUrl);
    const fileAttachments = toWebFileAttachmentPayloads(pendingFiles);
    const snapshot = {
      prompt,
      pendingImages,
      pendingFiles,
      webSearchEnabled,
    };
    let nextPrompt = trimmed;

    if (webSearchEnabled) {
      nextPrompt = nextPrompt
        ? `Pesquise na web quando necessário.\n\n${nextPrompt}`
        : 'Pesquise na web quando necessário.';
    }

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

    const restoreSnapshot = () => {
      pendingImagesRef.current = snapshot.pendingImages;
      pendingFilesRef.current = snapshot.pendingFiles;
      promptRef.current = snapshot.prompt;
      setPendingImages(snapshot.pendingImages);
      setPendingFiles(snapshot.pendingFiles);
      setPrompt(snapshot.prompt);
      setWebSearchEnabled(snapshot.webSearchEnabled);
      window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) {
          return;
        }
        input.focus();
        const caret = snapshot.prompt.length;
        input.setSelectionRange(caret, caret);
        resizeAskInput(input);
      });
    };

    submitInFlightRef.current = true;
    setPrompt('');
    setPendingImages([]);
    setPendingFiles([]);
    setWebSearchEnabled(false);
    setPreviewImageSrc(null);
    promptRef.current = '';
    pendingImagesRef.current = [];
    pendingFilesRef.current = [];
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    void Promise.resolve(onSubmit(nextPrompt, imageDataUrls, fileAttachments))
      .then((ok) => {
        if (ok === false) {
          restoreSnapshot();
        }
      })
      .catch(() => {
        restoreSnapshot();
      })
      .finally(() => {
        submitInFlightRef.current = false;
      });
  }, [
    canSubmit,
    onSubmit,
    pendingFiles,
    pendingImages,
    prompt,
    resizeAskInput,
    webSearchEnabled,
  ]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submitPrompt();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitPrompt();
    }
  };

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (imageActionsDisabled) {
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
    [imageActionsDisabled, ingestFiles],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLFormElement>) => {
      if (imageActionsDisabled) {
        return;
      }
      if (![...event.dataTransfer.types].includes('Files')) {
        return;
      }
      event.preventDefault();
      setDropActive(true);
    },
    [imageActionsDisabled],
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

      if (imageActionsDisabled) {
        return;
      }

      void ingestFiles(event.dataTransfer.files).then(() => {
        inputRef.current?.focus();
      });
    },
    [imageActionsDisabled, ingestFiles],
  );

  const handleAttachImageClick = useCallback(() => {
    if (imageActionsDisabled) {
      return;
    }
    closeAttachMenu();
    imageInputRef.current?.click();
  }, [closeAttachMenu, imageActionsDisabled]);

  const handleAttachFileClick = useCallback(() => {
    if (imageActionsDisabled) {
      return;
    }
    closeAttachMenu();
    fileInputRef.current?.click();
  }, [closeAttachMenu, imageActionsDisabled]);

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
    <div className='home-dashboard__ask-bar'>
      <form
        ref={askFormRef}
        className={`home-dashboard__ask app-button--enter${
          dropActive ? ' home-dashboard__ask--drop-target' : ''
        }`}
        onSubmit={handleSubmit}
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
                    disabled={imageActionsDisabled}
                    onClick={() =>
                      handlePreviewImage(image.dataUrl, `imagem-${imageNumber}.png`)
                    }
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
                    disabled={imageActionsDisabled}
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
                  disabled={imageActionsDisabled}
                  onClick={() => removePendingFile(file.id)}
                >
                  <X size={12} strokeWidth={2.5} aria-hidden='true' />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className='home-dashboard__ask-selects'>
          {hideProjectSelect ? null : (
            <WebAskMenuSelect
              value={projectId ?? ''}
              options={projectOptions}
              disabled={projects.length === 0 || submitting}
              ariaLabel='Projeto'
              triggerLabel={selectedProject?.name ?? 'Escolha um projeto'}
              triggerLeading={
                <ProjectLeading
                  logoUrl={selectedProject?.logo_url ?? null}
                  color={selectedProject?.color ?? null}
                  icon={selectedProject?.icon ?? null}
                />
              }
              onChange={(next) => {
                if (next) {
                  onProjectChange(next);
                }
              }}
            />
          )}
          <button
            ref={desktopAgentsTriggerRef}
            type='button'
            className={`home-dashboard__ask-desktop-agents app-button app-button--enter${
              desktopAgentsPhase === 'in' ? ' home-dashboard__ask-desktop-agents--open' : ''
            }`}
            aria-label='Agents ativos no Desktop'
            aria-haspopup='menu'
            aria-expanded={desktopAgentsPhase === 'in'}
            title='Agents ativos no Desktop'
            disabled={!projectId || submitting}
            onClick={() => {
              if (desktopAgentsPhase === 'in') {
                closeDesktopAgentsMenu();
                return;
              }
              void openDesktopAgentsMenu();
            }}
          >
            <Bot size={16} strokeWidth={2} aria-hidden='true' />
          </button>
          <WebMacSelect
            devices={devices}
            deviceId={deviceId}
            onDeviceChange={onDeviceChange}
            disabled={submitting}
            className='web-ask-mac-select--bar'
          />
        </div>
        <div className='home-dashboard__ask-main'>
          <div className='home-dashboard__ask-input-wrap'>
            <div className='home-dashboard__ask-input-mirror' aria-hidden='true'>
              {prompt ? (
                <WebAgentPromptImageMentionText
                  text={prompt}
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
              placeholder='Pergunte algo ao Nexus...'
              disabled={submitting}
              spellCheck={false}
              aria-label='Pergunte algo ao Nexus'
              onChange={(event) => {
                setPrompt(event.target.value);
                resizeAskInput(event.target);
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
          </div>
        </div>
        <div className='home-dashboard__ask-actions'>
          <button
            ref={attachTriggerRef}
            type='button'
            className={`home-dashboard__ask-action app-button${
              attachMenuOpen ? ' home-dashboard__ask-action--open' : ''
            }`}
            aria-label='Anexar'
            aria-haspopup='menu'
            aria-expanded={attachMenuOpen}
            disabled={imageActionsDisabled}
            title='Anexar'
            onClick={() => {
              if (attachMenuOpen) {
                closeAttachMenu();
                return;
              }
              openAttachMenu();
            }}
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
            className={`home-dashboard__ask-action app-button${
              webSearchEnabled ? ' home-dashboard__ask-action--active' : ''
            }`}
            aria-label='Pesquisar na web'
            aria-pressed={webSearchEnabled}
            disabled={submitting}
            onClick={() => setWebSearchEnabled((current) => !current)}
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
      </form>
      {previewImageSrc ? (
        <WebMarkdownImageLightbox
          src={previewImageSrc}
          fileName={previewImageName}
          onClose={handleClosePreview}
        />
      ) : null}
      {attachMenuOpen && attachMenuRect
        ? createPortal(
            <div
              ref={attachMenuRef}
              className={`context-menu overlay-popup overlay-popup--${attachMenuPhase}`}
              role='menu'
              style={{
                left: Math.max(12, Math.min(attachMenuRect.left, window.innerWidth - 200)),
                bottom: window.innerHeight - attachMenuRect.top + 6,
                zIndex: 10000,
              }}
              onAnimationEnd={() => {
                if (attachMenuPhase === 'out') {
                  setAttachMenuOpen(false);
                  setAttachMenuRect(null);
                }
              }}
            >
              <button
                type='button'
                className='context-menu__item app-button app-button--enter'
                role='menuitem'
                onClick={handleAttachImageClick}
              >
                <Image size={14} strokeWidth={2} aria-hidden='true' />
                <span>Imagem</span>
              </button>
              <button
                type='button'
                className='context-menu__item app-button app-button--enter'
                role='menuitem'
                onClick={handleAttachFileClick}
              >
                <FileText size={14} strokeWidth={2} aria-hidden='true' />
                <span>Arquivo</span>
              </button>
            </div>,
            document.body,
          )
        : null}
      {desktopAgentsPhase !== 'closed' && desktopAgentsMenuRect
        ? createPortal(
            <div
              ref={desktopAgentsMenuRef}
              className={`web-desktop-agents-popup context-menu overlay-popup overlay-popup--${desktopAgentsPhase}${
                desktopAgentsMenuRect.openUp
                  ? ' web-desktop-agents-popup--up'
                  : ' web-desktop-agents-popup--down'
              }`}
              role='menu'
              aria-label='Agents ativos no Desktop'
              style={{
                left: desktopAgentsMenuRect.left,
                maxHeight: desktopAgentsMenuRect.maxHeight,
                ...(desktopAgentsMenuRect.openUp
                  ? { bottom: desktopAgentsMenuRect.bottom, top: 'auto' }
                  : { top: desktopAgentsMenuRect.top, bottom: 'auto' }),
              }}
              onAnimationEnd={() => {
                if (desktopAgentsPhase === 'out') {
                  setDesktopAgentsPhase('closed');
                  setDesktopAgentsMenuRect(null);
                }
              }}
            >
              <div className='web-desktop-agents-popup__header'>Agents no Desktop</div>
              {desktopAgentsLoading ? (
                <div className='web-desktop-agents-popup__empty'>Atualizando…</div>
              ) : desktopAgentsForProject.length === 0 ? (
                <div className='empty-state web-desktop-agents-popup__empty-state'>
                  <div className='empty-state__icon'>
                    <Bot size={22} aria-hidden='true' />
                  </div>
                  <p className='empty-state__message'>Nenhum agent ativo neste projeto</p>
                </div>
              ) : (
                <ul className='web-desktop-agents-popup__list'>
                  {desktopAgentsForProject.map((agent) => (
                    <li key={agent.id}>
                      <button
                        type='button'
                        className='web-desktop-agents-popup__item app-button app-button--enter'
                        role='menuitem'
                        onClick={() => {
                          onSelectAgent(agent.id);
                          closeDesktopAgentsMenu();
                        }}
                      >
                        <Bot
                          size={14}
                          strokeWidth={2.25}
                          className='web-desktop-agents-popup__item-icon'
                          aria-hidden='true'
                        />
                        <span className='web-desktop-agents-popup__item-title'>
                          {agent.prompt || 'Agent'}
                        </span>
                        <span
                          className={`web-desktop-agents-popup__item-status web-desktop-agents-popup__item-status--${agent.status}`}
                        >
                          {agent.status === 'running'
                            ? 'Executando'
                            : agent.status === 'error'
                              ? 'Erro'
                              : 'Aberto'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
