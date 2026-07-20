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
import { ArrowUp, AtSign, Bot, FolderKanban, Globe, Layers, Paperclip, X } from 'lucide-react';
import type { CloudProject, DeviceRecord } from '@nexus/protocol';
import type { WebAgentSession } from '../store';
import { WebAskMenuSelect } from './WebAskMenuSelect';
import { WebMacSelect } from './WebMacSelect';
import { WebAgentPromptImageMentionText } from './WebAgentPromptImageMentionText';
import { WebMarkdownImageLightbox } from './WebMarkdownImageLightbox';
import {
  buildWebAgentPromptImageMention,
  buildWebAgentPromptImageMentionInsertion,
  getWebAgentPromptImageBadgeColor,
  MAX_WEB_PROMPT_IMAGES,
  readImageFilesAsDataUrls,
  renumberWebAgentPromptImages,
  WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX,
  type WebPendingAskImage,
} from './webAgentPromptImages';

interface WebMaestroAskBarProps {
  projects: CloudProject[];
  projectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  devices: DeviceRecord[];
  deviceId: string | null;
  onDeviceChange: (deviceId: string | null) => void;
  agents: WebAgentSession[];
  agentFilterProjectId: string | null;
  onAgentFilterChange: (projectId: string | null) => void;
  submitting: boolean;
  onSubmit: (prompt: string, imageDataUrls?: string[]) => boolean | Promise<boolean>;
}

interface OpenAgentProjectEntry {
  key: string;
  projectId: string | null;
  name: string;
  color: string;
  logoUrl: string | null;
  icon: string | null;
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

function RoundProjectThumb({
  logoUrl,
  color,
  icon,
}: {
  logoUrl: string | null;
  color: string;
  icon: string | null;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=''
        className='home-dashboard__open-agent-project-logo'
        draggable={false}
      />
    );
  }

  return (
    <span className='home-dashboard__open-agent-project-icon' style={{ background: color }}>
      {icon ? (
        <span className='web-ask-project-letter'>{icon.slice(0, 1)}</span>
      ) : (
        <Bot size={16} aria-hidden='true' />
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
  agents,
  agentFilterProjectId,
  onAgentFilterChange,
  submitting,
  onSubmit,
}: WebMaestroAskBarProps) {
  const [prompt, setPrompt] = useState('');
  const [pendingImages, setPendingImages] = useState<WebPendingAskImage[]>([]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewImageName, setPreviewImageName] = useState('imagem.png');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askFormRef = useRef<HTMLFormElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef(prompt);
  const pendingImagesRef = useRef(pendingImages);
  const submitInFlightRef = useRef(false);

  promptRef.current = prompt;
  pendingImagesRef.current = pendingImages;

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const canSubmit =
    (prompt.trim().length > 0 || pendingImages.length > 0) &&
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

  const openAgentProjects = useMemo(() => {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const byKey = new Map<string, OpenAgentProjectEntry>();

    for (const agent of agents) {
      const project = agent.projectId ? projectsById.get(agent.projectId) : null;
      const key = agent.projectId ?? `agent:${agent.id}`;

      if (byKey.has(key)) {
        continue;
      }

      byKey.set(key, {
        key,
        projectId: agent.projectId,
        name: project?.name ?? agent.projectName,
        color: project?.color || agent.projectColor || '#8b5cf6',
        logoUrl: project?.logo_url ?? agent.logoUrl,
        icon: project?.icon ?? null,
      });
    }

    return Array.from(byKey.values());
  }, [agents, projects]);

  const showOpenAgentProjects = openAgentProjects.length >= 2;

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
  }, [syncAskBarHeight, prompt, pendingImages.length]);

  const submitPrompt = useCallback(() => {
    if (!canSubmit || submitInFlightRef.current) {
      return;
    }

    const trimmed = prompt.trim();
    const imageDataUrls = pendingImages.map((image) => image.dataUrl);
    const snapshot = {
      prompt,
      pendingImages,
      webSearchEnabled,
    };
    let nextPrompt = trimmed;

    if (webSearchEnabled) {
      nextPrompt = nextPrompt
        ? `Pesquise na web quando necessário.\n\n${nextPrompt}`
        : 'Pesquise na web quando necessário.';
    }

    if (!nextPrompt && imageDataUrls.length > 0) {
      nextPrompt = pendingImages
        .map((_, index) => `(img ${index + 1})`)
        .join(' ');
    }

    const restoreSnapshot = () => {
      pendingImagesRef.current = snapshot.pendingImages;
      promptRef.current = snapshot.prompt;
      setPendingImages(snapshot.pendingImages);
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
    setWebSearchEnabled(false);
    setPreviewImageSrc(null);
    promptRef.current = '';
    pendingImagesRef.current = [];
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    void Promise.resolve(onSubmit(nextPrompt, imageDataUrls))
      .then((ok) => {
        if (!ok) {
          restoreSnapshot();
        }
      })
      .catch(() => {
        restoreSnapshot();
      })
      .finally(() => {
        submitInFlightRef.current = false;
      });
  }, [canSubmit, onSubmit, pendingImages, prompt, resizeAskInput, webSearchEnabled]);

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
      void readImageFilesAsDataUrls([imageFile]).then((dataUrls) => {
        attachImagesWithMentions(dataUrls);
      });
    },
    [attachImagesWithMentions, imageActionsDisabled],
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

      void readImageFilesAsDataUrls(event.dataTransfer.files).then((dataUrls) => {
        attachImagesWithMentions(dataUrls);
        inputRef.current?.focus();
      });
    },
    [attachImagesWithMentions, imageActionsDisabled],
  );

  const handleAttachImageClick = useCallback(() => {
    if (imageActionsDisabled) {
      return;
    }
    imageInputRef.current?.click();
  }, [imageActionsDisabled]);

  const handleImageInputChange = useCallback(() => {
    const input = imageInputRef.current;
    if (!input?.files || input.files.length === 0) {
      return;
    }

    void readImageFilesAsDataUrls(input.files).then((dataUrls) => {
      attachImagesWithMentions(dataUrls);
      input.value = '';
      inputRef.current?.focus();
    });
  }, [attachImagesWithMentions]);

  return (
    <div className='home-dashboard__ask-bar'>
      {showOpenAgentProjects ? (
        <div
          className='home-dashboard__open-agent-projects app-button--enter'
          aria-label='Filtrar agents por projeto'
        >
          <div className='home-dashboard__open-agent-projects-track'>
            <button
              type='button'
              className={`home-dashboard__open-agent-project app-button app-button--enter${
                agentFilterProjectId === null
                  ? ' home-dashboard__open-agent-project--active'
                  : ''
              }`}
              title='Todos'
              aria-label='Mostrar todos os agents'
              aria-pressed={agentFilterProjectId === null}
              disabled={submitting}
              onClick={() => onAgentFilterChange(null)}
            >
              <span className='home-dashboard__open-agent-project-icon home-dashboard__open-agent-project-icon--all'>
                <Layers size={16} aria-hidden='true' />
              </span>
            </button>
            {openAgentProjects.map((entry) => {
              const isActive =
                entry.projectId !== null && entry.projectId === agentFilterProjectId;
              return (
                <button
                  key={entry.key}
                  type='button'
                  className={`home-dashboard__open-agent-project app-button app-button--enter${
                    isActive ? ' home-dashboard__open-agent-project--active' : ''
                  }`}
                  title={entry.name}
                  aria-label={`Mostrar agents de ${entry.name}`}
                  aria-pressed={isActive}
                  disabled={submitting || !entry.projectId}
                  onClick={() => {
                    if (!entry.projectId) {
                      return;
                    }
                    onAgentFilterChange(entry.projectId);
                    onProjectChange(entry.projectId);
                  }}
                >
                  <RoundProjectThumb
                    logoUrl={entry.logoUrl}
                    color={entry.color}
                    icon={entry.icon}
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
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
          accept='image/*'
          multiple
          hidden
          onChange={handleImageInputChange}
        />
        {pendingImages.length > 0 ? (
          <div
            className='home-dashboard__ask-attachments app-button--enter'
            aria-label='Imagens anexadas'
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
          </div>
        ) : null}
        <div className='home-dashboard__ask-selects'>
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
            type='button'
            className='home-dashboard__ask-action app-button'
            aria-label='Anexar imagem'
            disabled={imageActionsDisabled}
            title='Anexar imagem'
            onClick={handleAttachImageClick}
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
    </div>
  );
}
