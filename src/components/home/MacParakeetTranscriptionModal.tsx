import { CalendarDays, Check, Clock, Copy, FolderKanban, Languages, ListTodo, Loader2, MessageSquareText, Mic, Pencil, Sparkles, Timer, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentResponseCopyPill } from '@/components/agent/AgentResponseCopyPill';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { MacParakeetTranscriptionDetail, MacParakeetTranscriptSegment, Project } from '@/types';
import {
  formatMacParakeetDate,
  formatMacParakeetDuration,
  formatMacParakeetSegmentTime,
  resolveMacParakeetSourceAccent,
  resolveMacParakeetSourceLabel,
} from '@/utils/macParakeetLabels';
import { renderMarkdownPreview } from '@/utils/markdownPreview';

type MacParakeetModalTab = 'transcription' | 'conclusion';

interface MacParakeetTranscriptionTitleProps {
  title: string;
  onRename: (title: string) => Promise<string | null>;
}

interface MacParakeetTranscriptionModalProps {
  detail: MacParakeetTranscriptionDetail;
  detailLoading?: boolean;
  translating?: boolean;
  projects: Project[];
  linkedProjectId: string;
  linkingProject?: boolean;
  onLinkedProjectChange: (projectId: string) => void;
  onClose: () => void;
  onRenameTitle: (id: string, title: string) => Promise<string | null>;
  onTranslateConclusion: () => void;
  onCreateTask: () => void;
  createTaskDisabled?: boolean;
}

interface MacParakeetSpeechSegmentProps {
  segment: MacParakeetTranscriptSegment;
}

interface TranscriptionProjectThumbProps {
  project: Project | null;
}

function TranscriptionProjectThumbComponent({ project }: TranscriptionProjectThumbProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!project?.logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(project.logo).then((dataUrl) => {
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
  }, [project?.logo]);

  if (!project) {
    return <FolderKanban size={14} strokeWidth={2} />;
  }

  if (logoSrc && !logoFailed) {
    return <img src={logoSrc} alt='' className='macparakeet-transcription-modal__project-logo' />;
  }

  return (
    <span
      className='macparakeet-transcription-modal__project-icon'
      style={{ backgroundColor: project.color }}
    >
      <ProjectIconMark icon={project.icon} size={11} />
    </span>
  );
}

const TranscriptionProjectThumb = memo(TranscriptionProjectThumbComponent);

function MacParakeetSpeechSegmentComponent({ segment }: MacParakeetSpeechSegmentProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!segment.content.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(segment.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [segment.content]);

  return (
    <div
      className={`macparakeet-transcription-modal__speech-row${segment.isSelf ? ' macparakeet-transcription-modal__speech-row--self' : ''}`}
    >
      <article
        className={`macparakeet-transcription-modal__speech${segment.isSelf ? ' macparakeet-transcription-modal__speech--self' : ''}${segment.isQuestion ? ' macparakeet-transcription-modal__speech--question' : ''}`}
      >
        <div className='macparakeet-transcription-modal__speech-body'>
          <p className='macparakeet-transcription-modal__speech-text'>{segment.content}</p>
          <footer className='macparakeet-transcription-modal__speech-meta'>
            {segment.speakerLabel ? (
              <>
                <span className='macparakeet-transcription-modal__speech-speaker'>{segment.speakerLabel}</span>
                <span className='macparakeet-transcription-modal__speech-separator' aria-hidden='true'>
                  ·
                </span>
              </>
            ) : null}
            <span className='macparakeet-transcription-modal__speech-time'>
              {formatMacParakeetSegmentTime(segment.createdAt)}
            </span>
          </footer>
        </div>
        <button
          type='button'
          className={`macparakeet-transcription-modal__speech-copy app-button app-button--enter${copied ? ' macparakeet-transcription-modal__speech-copy--copied' : ''}`}
          aria-label={copied ? 'Texto copiado' : 'Copiar fala'}
          onClick={() => void handleCopy()}
        >
          <span className='agent-view__response-copy-icon' aria-hidden='true'>
            <Copy size={12} className='agent-view__response-copy-icon-copy' />
            <Check size={12} className='agent-view__response-copy-icon-check' />
          </span>
        </button>
      </article>
    </div>
  );
}

const MacParakeetSpeechSegment = memo(MacParakeetSpeechSegmentComponent);

interface MacParakeetConclusionPanelProps {
  conclusion: string;
}

function MacParakeetConclusionPanelComponent({ conclusion }: MacParakeetConclusionPanelProps) {
  const html = useMemo(() => renderMarkdownPreview(conclusion), [conclusion]);

  return (
    <div
      className='macparakeet-transcription-modal__conclusion markdown-preview'
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const MacParakeetConclusionPanel = memo(MacParakeetConclusionPanelComponent);

function MacParakeetTranscriptionTitleComponent({
  title,
  onRename,
}: MacParakeetTranscriptionTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(title);
    }
  }, [isEditing, title]);

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const handleStartEditing = useCallback(() => {
    if (saving) {
      return;
    }

    setDraft(title);
    setIsEditing(true);
  }, [saving, title]);

  const handleCancelEditing = useCallback(() => {
    setDraft(title);
    setIsEditing(false);
  }, [title]);

  const handleCommitEditing = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === title) {
      handleCancelEditing();
      return;
    }

    setSaving(true);

    try {
      const nextTitle = await onRename(trimmed);
      if (nextTitle) {
        setIsEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }, [draft, handleCancelEditing, onRename, title]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void handleCommitEditing();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancelEditing();
      }
    },
    [handleCancelEditing, handleCommitEditing],
  );

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className='macparakeet-transcription-modal__title-input'
        value={draft}
        maxLength={120}
        disabled={saving}
        aria-label='Renomear título da chamada'
        onBlur={() => void handleCommitEditing()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleInputKeyDown}
      />
    );
  }

  return (
    <>
      <button
        type='button'
        className='macparakeet-transcription-modal__title-button app-button'
        title={title}
        onClick={handleStartEditing}
      >
        {title}
      </button>
      <button
        type='button'
        className='macparakeet-transcription-modal__title-edit app-button app-button--enter'
        aria-label='Renomear título da chamada'
        onClick={handleStartEditing}
      >
        <Pencil size={13} strokeWidth={2} />
      </button>
    </>
  );
}

const MacParakeetTranscriptionTitle = memo(MacParakeetTranscriptionTitleComponent);

function MacParakeetTranscriptionModalComponent({
  detail,
  detailLoading = false,
  translating = false,
  projects,
  linkedProjectId,
  linkingProject = false,
  onLinkedProjectChange,
  onClose,
  onRenameTitle,
  onTranslateConclusion,
  onCreateTask,
  createTaskDisabled = false,
}: MacParakeetTranscriptionModalProps) {
  const [activeTab, setActiveTab] = useState<MacParakeetModalTab>('transcription');

  useEffect(() => {
    setActiveTab('transcription');
  }, [detail.id]);

  const hasTranscription =
    !detailLoading && detail.segments.some((segment) => segment.kind === 'speech');
  const hasConclusion = !detailLoading && Boolean(detail.conclusion?.trim());
  const canTranslate = hasConclusion && !detailLoading && !translating;

  const timeline = useMemo(
    () => detail.segments.filter((segment) => segment.kind === 'speech'),
    [detail.segments],
  );

  const transcriptionCopyContent = useMemo(() => {
    if (timeline.length > 0) {
      return timeline
        .map((segment) => segment.content.trim())
        .filter(Boolean)
        .join('\n\n');
    }

    return detail.transcript.trim();
  }, [detail.transcript, timeline]);

  const copyContent = useMemo(() => {
    if (activeTab === 'conclusion') {
      return detail.conclusion?.trim() ?? '';
    }

    return transcriptionCopyContent;
  }, [activeTab, detail.conclusion, transcriptionCopyContent]);

  const handleRenameTitle = useCallback(
    (nextTitle: string) => onRenameTitle(detail.id, nextTitle),
    [detail.id, onRenameTitle],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === linkedProjectId) ?? null,
    [linkedProjectId, projects],
  );

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({
        value: project.id,
        label: project.name,
        icon: <TranscriptionProjectThumb project={project} />,
      })),
    [projects],
  );

  const projectLeadingIcon = useMemo(
    () => <TranscriptionProjectThumb project={selectedProject} />,
    [selectedProject],
  );

  return (
    <AnimatedModal panelClassName='project-dialog macparakeet-transcription-modal' onClose={onClose}>
      {(requestClose) => (
        <div className='macparakeet-transcription-modal__panel agent-cursor-usage__panel'>
          <div className='agent-cursor-usage__header'>
            <div className='agent-cursor-usage__title-wrap macparakeet-transcription-modal__title-wrap'>
              <span className='agent-cursor-usage__title-leading'>
                <Mic size={16} />
              </span>
              <MacParakeetTranscriptionTitle title={detail.title} onRename={handleRenameTitle} />
            </div>
            <button
              type='button'
              className='agent-cursor-usage__close app-button app-button--enter'
              aria-label='Fechar'
              onClick={requestClose}
            >
              <X size={14} />
            </button>
          </div>

          <div className='macparakeet-transcription-modal__meta'>
            <span
              className='home-dashboard__parakeet-chip'
              style={{
                ['--parakeet-accent' as string]: resolveMacParakeetSourceAccent(detail.sourceType),
              }}
            >
              {resolveMacParakeetSourceLabel(detail.sourceType)}
            </span>
            <span className='macparakeet-transcription-modal__meta-item'>
              <Timer size={12} strokeWidth={2} className='macparakeet-transcription-modal__meta-icon' aria-hidden='true' />
              {formatMacParakeetDuration(detail.durationMs)}
            </span>
            <span className='macparakeet-transcription-modal__meta-item'>
              <CalendarDays size={12} strokeWidth={2} className='macparakeet-transcription-modal__meta-icon' aria-hidden='true' />
              {formatMacParakeetDate(detail.createdAt)}
            </span>
            <span className='macparakeet-transcription-modal__meta-item'>
              <Clock size={12} strokeWidth={2} className='macparakeet-transcription-modal__meta-icon' aria-hidden='true' />
              {formatMacParakeetSegmentTime(detail.createdAt)}
            </span>
            {detail.channelName ? (
              <span className='macparakeet-transcription-modal__meta-item'>{detail.channelName}</span>
            ) : null}
          </div>

          <div className='macparakeet-transcription-modal__project'>
            <AnchoredSelect
              value={linkedProjectId}
              options={projectOptions}
              allowEmpty
              emptyLabel='Sem projeto'
              placeholder='Selecionar projeto'
              leadingIcon={projectLeadingIcon}
              disabled={projects.length === 0 || linkingProject || detailLoading}
              onChange={onLinkedProjectChange}
              className='macparakeet-transcription-modal__project-select-wrap'
              triggerClassName='macparakeet-transcription-modal__project-select'
            />
          </div>

          <div className='macparakeet-transcription-modal__tabs' role='tablist'>
            <button
              type='button'
              role='tab'
              aria-selected={activeTab === 'transcription'}
              className={`macparakeet-transcription-modal__tab app-button app-button--enter${activeTab === 'transcription' ? ' macparakeet-transcription-modal__tab--active' : ''}`}
              onClick={() => setActiveTab('transcription')}
            >
              <MessageSquareText size={13} />
              <span>Transcrição</span>
            </button>
            <button
              type='button'
              role='tab'
              aria-selected={activeTab === 'conclusion'}
              className={`macparakeet-transcription-modal__tab app-button app-button--enter${activeTab === 'conclusion' ? ' macparakeet-transcription-modal__tab--active' : ''}`}
              onClick={() => setActiveTab('conclusion')}
            >
              <Sparkles size={13} />
              <span>Conclusão</span>
            </button>
          </div>

          <div className='macparakeet-transcription-modal__body'>
            {detailLoading ? (
              <div className='macparakeet-transcription-modal__loading' aria-busy='true'>
                <Loader2 size={20} className='macparakeet-transcription-modal__loading-spinner' />
                <span>Carregando transcrição...</span>
              </div>
            ) : activeTab === 'transcription' ? (
              hasTranscription ? (
                <div className='macparakeet-transcription-modal__timeline'>
                  {timeline.map((segment) => (
                    <MacParakeetSpeechSegment key={segment.id} segment={segment} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={Mic} message='Transcrição vazia' compact />
              )
            ) : hasConclusion ? (
              <MacParakeetConclusionPanel conclusion={detail.conclusion ?? ''} />
            ) : (
              <EmptyState icon={Sparkles} message='Conclusão ainda não disponível' compact />
            )}
          </div>

          <div className='macparakeet-transcription-modal__footer'>
            <AgentResponseCopyPill content={copyContent} nexusGo />
            <button
              type='button'
              className='agent-view__response-pill agent-view__response-copy app-button app-button--enter nexus-go-surface macparakeet-transcription-modal__translate'
              aria-label='Traduzir conclusão para português'
              disabled={!canTranslate}
              onClick={() => {
                setActiveTab('conclusion');
                onTranslateConclusion();
              }}
            >
              <span className='agent-view__response-copy-icon' aria-hidden='true'>
                {translating ? <Loader2 size={12} className='macparakeet-transcription-modal__translate-spinner' /> : <Languages size={12} />}
              </span>
              <span className='agent-view__response-copy-label'>
                {translating ? 'Traduzindo...' : 'Traduzir'}
              </span>
            </button>
            <button
              type='button'
              className='agent-view__response-pill agent-view__response-copy app-button app-button--enter nexus-go-surface macparakeet-transcription-modal__create-task'
              aria-label='Criar task a partir da transcrição'
              disabled={createTaskDisabled || detailLoading || !transcriptionCopyContent.trim()}
              onClick={onCreateTask}
            >
              <span className='agent-view__response-copy-icon' aria-hidden='true'>
                <ListTodo size={12} />
              </span>
              <span className='agent-view__response-copy-label'>Criar task</span>
            </button>
          </div>
        </div>
      )}
    </AnimatedModal>
  );
}

export const MacParakeetTranscriptionModal = memo(MacParakeetTranscriptionModalComponent);
