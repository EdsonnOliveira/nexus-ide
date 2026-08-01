import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { EditorView } from '@codemirror/view';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from '@/components/file/CodeEditor';
import { AgentGitPromptModal } from '@/components/git/AgentGitPromptChip';
import { isImageFileName } from '@/utils/fileViewMode';
import { getGitDiffEditableChangeLineNumbers } from '@/utils/gitDiffEditorExtensions';
import { toGitRelativePath } from '@/utils/gitPaths';
import type { AgentGitFilePromptTurn } from '@/utils/injectAgentPromptsIntoDiff';

interface GitDiffScrollbarMarker {
  id: string;
  kind: 'add' | 'remove';
  top: number;
  height: number;
  changeIndex: number;
}

interface GitDiffViewProps {
  filePath: string;
  before: string;
  after: string;
  isVisible: boolean;
  agentPromptTurns?: AgentGitFilePromptTurn[];
  diffRepoPath?: string;
  diffStaged?: boolean;
  diffUntracked?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  saveStatus?: string | null;
  saveError?: boolean;
}

function GitDiffImagePanel({
  label,
  src,
  fileName,
}: {
  label: string;
  src: string;
  fileName: string;
}) {
  return (
    <div className='git-diff-view__image-panel'>
      <span className='git-diff-view__image-label'>{label}</span>
      <div className='git-diff-view__image-frame'>
        <img src={src} alt={`${label} — ${fileName}`} className='git-diff-view__image' draggable={false} />
      </div>
    </div>
  );
}

function GitDiffScrollbarGutter({
  markers,
  onMarkerClick,
}: {
  markers: GitDiffScrollbarMarker[];
  onMarkerClick: (changeIndex: number) => void;
}) {
  if (markers.length === 0) {
    return null;
  }

  return (
    <div className='git-diff-view__scrollbar-gutter' aria-hidden='true'>
      {markers.map((marker) => (
        <button
          key={marker.id}
          type='button'
          className={`git-diff-view__scrollbar-marker git-diff-view__scrollbar-marker--${marker.kind} app-button`}
          style={{ top: `${marker.top}%`, height: `${marker.height}%` }}
          onClick={() => onMarkerClick(marker.changeIndex)}
        />
      ))}
    </div>
  );
}

function GitDiffViewComponent({
  filePath,
  before,
  after,
  isVisible,
  agentPromptTurns = [],
  diffRepoPath,
  diffStaged = false,
  diffUntracked = false,
  onChange,
  onSave,
  saveStatus = null,
  saveError = false,
}: GitDiffViewProps) {
  const editorViewRef = useRef<EditorView | null>(null);
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [scrollbarMarkers, setScrollbarMarkers] = useState<GitDiffScrollbarMarker[]>([]);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [pathCopied, setPathCopied] = useState(false);
  const [imageBeforeSrc, setImageBeforeSrc] = useState<string | null>(null);
  const [imageAfterSrc, setImageAfterSrc] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileName = useMemo(() => filePath.split('/').pop() ?? filePath, [filePath]);
  const isImageDiff = useMemo(() => isImageFileName(fileName), [fileName]);
  const [changeLineNumbers, setChangeLineNumbers] = useState<number[]>([]);
  const changeCount = changeLineNumbers.length;
  const promptLabel = agentPromptTurns[0]?.prompt?.trim() || null;

  useEffect(() => {
    if (isImageDiff) {
      setChangeLineNumbers([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      setChangeLineNumbers(getGitDiffEditableChangeLineNumbers(before, after));
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [after, before, isImageDiff]);

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(filePath);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1500);
    } catch {
      setPathCopied(false);
    }
  }, [filePath]);

  const handleOpenPromptModal = useCallback((prompt: string) => {
    setExpandedPrompt(prompt);
  }, []);

  const handleClosePromptModal = useCallback(() => {
    setExpandedPrompt(null);
  }, []);

  const handleCreateEditor = useCallback((view: EditorView) => {
    editorViewRef.current = view;
  }, []);

  const handleContentChange = useCallback(
    (value: string) => {
      if (value === after) {
        return;
      }

      onChange?.(value);
    },
    [after, onChange],
  );

  const scrollToChange = useCallback(
    (changeIndex: number) => {
      const view = editorViewRef.current;
      const lineNumber = changeLineNumbers[changeIndex];

      if (!view || lineNumber === undefined) {
        return;
      }

      if (lineNumber < 1 || lineNumber > view.state.doc.lines) {
        return;
      }

      const line = view.state.doc.line(lineNumber);
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, {
          y: 'center',
          yMargin: 40,
        }),
      });
      view.focus();
    },
    [changeLineNumbers],
  );

  const navigateToChange = useCallback(
    (changeIndex: number) => {
      if (changeIndex < 0 || changeIndex >= changeCount) {
        return;
      }

      setCurrentChangeIndex(changeIndex);
      scrollToChange(changeIndex);
    },
    [changeCount, scrollToChange],
  );

  const handlePreviousChange = useCallback(() => {
    navigateToChange(currentChangeIndex - 1);
  }, [currentChangeIndex, navigateToChange]);

  const handleNextChange = useCallback(() => {
    navigateToChange(currentChangeIndex + 1);
  }, [currentChangeIndex, navigateToChange]);

  useEffect(() => {
    if (changeCount === 0) {
      setCurrentChangeIndex(0);
      setScrollbarMarkers([]);
      return;
    }

    setCurrentChangeIndex((current) => Math.min(current, changeCount - 1));

    const totalLines = Math.max(after.split('\n').length, 1);
    setScrollbarMarkers(
      changeLineNumbers.map((lineNumber, changeIndex) => ({
        id: `change-${changeIndex}-${lineNumber}`,
        kind: 'add' as const,
        top: Math.min(96, Math.max(1, ((lineNumber - 1) / totalLines) * 100)),
        height: Math.max(1.2, (1 / totalLines) * 100),
        changeIndex,
      })),
    );
  }, [after, changeCount, changeLineNumbers]);

  useEffect(() => {
    if (!isImageDiff) {
      setImageBeforeSrc(null);
      setImageAfterSrc(null);
      setImageLoading(false);
      setImageError(null);
      return;
    }

    let cancelled = false;
    setImageLoading(true);
    setImageError(null);

    const loadImageSides = async () => {
      if (diffRepoPath) {
        const gitRelativePath = toGitRelativePath(diffRepoPath, filePath);
        const sides = await window.nexus.git.getFileDiffImageSides(diffRepoPath, gitRelativePath, {
          staged: diffStaged,
          untracked: diffUntracked,
        });

        if (cancelled) {
          return;
        }

        setImageBeforeSrc(sides.before);
        setImageAfterSrc(sides.after);
        setImageLoading(false);
        return;
      }

      const afterSrc = await window.nexus.files.readImageAsDataUrl(filePath);

      if (cancelled) {
        return;
      }

      setImageBeforeSrc(null);
      setImageAfterSrc(afterSrc);
      setImageLoading(false);

      if (!afterSrc) {
        setImageError('Não foi possível carregar a imagem');
      }
    };

    void loadImageSides().catch(() => {
      if (cancelled) {
        return;
      }

      setImageLoading(false);
      setImageError('Não foi possível carregar a imagem');
    });

    return () => {
      cancelled = true;
    };
  }, [diffRepoPath, diffStaged, diffUntracked, filePath, isImageDiff]);

  const showImageBefore = Boolean(imageBeforeSrc);
  const showImageAfter = Boolean(imageAfterSrc);
  const hasImageChanges = imageBeforeSrc !== imageAfterSrc;
  const showSingleImagePanel = showImageBefore !== showImageAfter;
  const showPreviousChange = currentChangeIndex > 0;
  const showNextChange = currentChangeIndex < changeCount - 1;
  const navControlsClassName = [
    'emulator-view__controls',
    'app-button--enter',
    showPreviousChange ? '' : 'emulator-view__controls--start',
    showNextChange ? '' : 'emulator-view__controls--end',
  ]
    .filter(Boolean)
    .join(' ');

  if (isImageDiff) {
    return (
      <div
        className={`file-view file-view--image file-view--diff git-diff-view git-diff-view--image${isVisible ? '' : ' file-view--hidden'}`}
      >
        <div className='git-diff-view__header'>
          <span className='git-diff-view__path' title={filePath}>
            {filePath}
          </span>
          <button
            type='button'
            className='git-diff-view__copy-path app-button app-button--enter'
            aria-label={pathCopied ? 'Caminho copiado' : 'Copiar caminho completo'}
            title={pathCopied ? 'Caminho copiado' : 'Copiar caminho completo'}
            onClick={() => void handleCopyPath()}
          >
            {pathCopied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
          </button>
        </div>
        <div className='git-diff-view__image-viewport'>
          {imageLoading ? (
            <div className='git-diff-view__empty'>Carregando preview...</div>
          ) : imageError ? (
            <div className='git-diff-view__empty git-diff-view__empty--error'>{imageError}</div>
          ) : !hasImageChanges && showImageBefore && showImageAfter ? (
            <div className='git-diff-view__empty'>Nenhuma alteração neste arquivo</div>
          ) : (
            <div
              className={`git-diff-view__image-panels${showSingleImagePanel ? ' git-diff-view__image-panels--single' : ''}`}
            >
              {showImageBefore && imageBeforeSrc ? (
                <GitDiffImagePanel label='Antes' src={imageBeforeSrc} fileName={fileName} />
              ) : null}
              {showImageAfter && imageAfterSrc ? (
                <GitDiffImagePanel
                  label={showImageBefore ? 'Depois' : 'Atual'}
                  src={imageAfterSrc}
                  fileName={fileName}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`file-view file-view--code file-view--diff git-diff-view git-diff-view--editable${isVisible ? '' : ' file-view--hidden'}`}
    >
      <div className='git-diff-view__header'>
        <span className='git-diff-view__path' title={filePath}>
          {filePath}
        </span>
        {promptLabel ? (
          <button
            type='button'
            className='git-diff-view__prompt-chip app-button app-button--enter'
            title={promptLabel}
            onClick={() => handleOpenPromptModal(promptLabel)}
          >
            &ldquo;{promptLabel}&rdquo;
          </button>
        ) : null}
        <button
          type='button'
          className='git-diff-view__copy-path app-button app-button--enter'
          aria-label={pathCopied ? 'Caminho copiado' : 'Copiar caminho completo'}
          title={pathCopied ? 'Caminho copiado' : 'Copiar caminho completo'}
          onClick={() => void handleCopyPath()}
        >
          {pathCopied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
        </button>
      </div>
      <div className='git-diff-view__viewport git-diff-view__viewport--editable'>
        <CodeEditor
          filePath={filePath}
          value={after}
          isVisible={isVisible}
          diffBefore={before}
          onChange={handleContentChange}
          onSave={onSave ?? (() => undefined)}
          onCreateEditor={handleCreateEditor}
        />
        <GitDiffScrollbarGutter markers={scrollbarMarkers} onMarkerClick={navigateToChange} />
        {changeCount > 0 ? (
          <div className='git-diff-view__nav'>
            <div
              className={navControlsClassName}
              role='toolbar'
              aria-label='Navegação de alterações'
            >
              {showPreviousChange ? (
                <button
                  type='button'
                  className='emulator-view__control app-button app-button--enter'
                  title='Alteração anterior'
                  aria-label='Alteração anterior'
                  onClick={handlePreviousChange}
                >
                  <ChevronUp size={18} strokeWidth={1.75} />
                </button>
              ) : null}
              <span className='git-diff-view__nav-position' aria-live='polite'>
                {currentChangeIndex + 1}/{changeCount}
              </span>
              {showNextChange ? (
                <button
                  type='button'
                  className='emulator-view__control app-button app-button--enter'
                  title='Próxima alteração'
                  aria-label='Próxima alteração'
                  onClick={handleNextChange}
                >
                  <ChevronDown size={18} strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {saveStatus ? (
        <div className={`file-view__save-status${saveError ? ' file-view__save-status--error' : ''}`}>
          {saveStatus}
        </div>
      ) : null}
      {expandedPrompt ? (
        <AgentGitPromptModal prompt={expandedPrompt} onClose={handleClosePromptModal} />
      ) : null}
    </div>
  );
}

export const GitDiffView = memo(GitDiffViewComponent);
