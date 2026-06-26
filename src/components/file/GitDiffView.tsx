import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentGitPromptModal } from '@/components/git/AgentGitPromptChip';
import { isImageFileName } from '@/utils/fileViewMode';
import { toGitRelativePath } from '@/utils/gitPaths';
import { highlightTextLinesByNumber } from '@/utils/codeHighlight';
import {
  buildGitDiffLines,
  getGitDiffChangeLineIndices,
  gitDiffHasChanges,
  type GitDiffLine,
} from '@/utils/gitDiffLines';
import {
  injectAgentPromptsIntoDiffLines,
  type AgentGitFilePromptTurn,
} from '@/utils/injectAgentPromptsIntoDiff';

interface GitDiffViewProps {
  filePath: string;
  before: string;
  after: string;
  isVisible: boolean;
  agentPromptTurns?: AgentGitFilePromptTurn[];
  diffRepoPath?: string;
  diffStaged?: boolean;
  diffUntracked?: boolean;
}

function resolveGitDiffLineHtml(
  line: GitDiffLine,
  beforeHighlights: Map<number, string>,
  afterHighlights: Map<number, string>,
): string {
  if (line.kind === 'remove' && line.oldLineNumber !== null) {
    return beforeHighlights.get(line.oldLineNumber) ?? '';
  }

  if (line.newLineNumber !== null) {
    return afterHighlights.get(line.newLineNumber) ?? '';
  }

  return '';
}

function GitDiffPromptRow({
  prompt,
  onOpen,
}: {
  prompt: string;
  onOpen: (prompt: string) => void;
}) {
  const labelRef = useRef<HTMLButtonElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const element = labelRef.current;

    if (!element) {
      return;
    }

    const checkTruncation = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    };

    checkTruncation();

    const observer = new ResizeObserver(checkTruncation);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [prompt]);

  const handleClick = useCallback(() => {
    if (isTruncated) {
      onOpen(prompt);
    }
  }, [isTruncated, onOpen, prompt]);

  return (
    <button
      ref={labelRef}
      type='button'
      className={`git-diff-view__prompt-btn app-button app-button--enter${isTruncated ? ' git-diff-view__prompt-btn--expandable' : ''}`}
      title={isTruncated ? prompt : undefined}
      onClick={handleClick}
    >
      &ldquo;{prompt}&rdquo;
    </button>
  );
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
        <img src={src} alt={fileName} className='git-diff-view__image' draggable={false} />
      </div>
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
}: GitDiffViewProps) {
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [currentChangeIndex, setCurrentChangeIndex] = useState(0);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [pathCopied, setPathCopied] = useState(false);
  const [imageBeforeSrc, setImageBeforeSrc] = useState<string | null>(null);
  const [imageAfterSrc, setImageAfterSrc] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileName = useMemo(() => filePath.split('/').pop() ?? filePath, [filePath]);
  const isImageDiff = useMemo(() => isImageFileName(fileName), [fileName]);
  const baseLines = useMemo(() => buildGitDiffLines(before, after), [after, before]);
  const lines = useMemo(
    () => injectAgentPromptsIntoDiffLines(baseLines, agentPromptTurns),
    [agentPromptTurns, baseLines],
  );
  const hasChanges = useMemo(() => gitDiffHasChanges(before, after), [after, before]);
  const changeLineIndices = useMemo(() => getGitDiffChangeLineIndices(lines), [lines]);
  const changeCount = changeLineIndices.length;
  const beforeHighlights = useMemo(
    () => highlightTextLinesByNumber(before, filePath),
    [before, filePath],
  );
  const afterHighlights = useMemo(
    () => highlightTextLinesByNumber(after, filePath),
    [after, filePath],
  );

  const lineIndexToChangeIndex = useMemo(() => {
    const map = new Map<number, number>();

    changeLineIndices.forEach((lineIndex, changeIndex) => {
      map.set(lineIndex, changeIndex);
    });

    return map;
  }, [changeLineIndices]);

  const setRowRef = useCallback(
    (lineIndex: number) => (element: HTMLDivElement | null) => {
      if (element) {
        rowRefs.current.set(lineIndex, element);
        return;
      }

      rowRefs.current.delete(lineIndex);
    },
    [],
  );

  const scrollToChange = useCallback((changeIndex: number) => {
    const lineIndex = changeLineIndices[changeIndex];

    if (lineIndex === undefined) {
      return;
    }

    const row = rowRefs.current.get(lineIndex);

    if (!row) {
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    row.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [changeLineIndices]);

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

  const handleOpenPromptModal = useCallback((prompt: string) => {
    setExpandedPrompt(prompt);
  }, []);

  const handleClosePromptModal = useCallback(() => {
    setExpandedPrompt(null);
  }, []);

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(filePath);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1500);
    } catch {
      setPathCopied(false);
    }
  }, [filePath]);

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

      setImageBeforeSrc(null);
      setImageAfterSrc(null);
      setImageError('Não foi possível carregar a imagem');
      setImageLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [diffRepoPath, diffStaged, diffUntracked, filePath, isImageDiff]);

  const hasImageChanges = imageBeforeSrc !== imageAfterSrc;
  const showImageBefore = Boolean(imageBeforeSrc);
  const showImageAfter = Boolean(imageAfterSrc);
  const showSingleImagePanel = showImageBefore !== showImageAfter;

  const showPreviousChange = currentChangeIndex > 0;
  const showNextChange = currentChangeIndex < changeCount - 1;
  const navControlsClassName = [
    'emulator-view__controls',
    'git-diff-view__nav-controls',
    'app-button--enter',
    !showPreviousChange && !showNextChange
      ? 'git-diff-view__nav-controls--counter-only'
      : showPreviousChange && !showNextChange
        ? 'git-diff-view__nav-controls--prev-only'
        : !showPreviousChange && showNextChange
          ? 'git-diff-view__nav-controls--next-only'
          : null,
  ]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (!isVisible || changeCount === 0) {
      return;
    }

    setCurrentChangeIndex(0);

    const frameId = window.requestAnimationFrame(() => {
      scrollToChange(0);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [after, before, changeCount, isVisible, scrollToChange]);

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
      className={`file-view file-view--code file-view--diff git-diff-view${isVisible ? '' : ' file-view--hidden'}`}
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
      <div className='git-diff-view__viewport'>
        <div className='git-diff-view__scroll'>
          <div className='git-diff-view__body'>
            {!hasChanges ? (
              <div className='git-diff-view__empty'>Nenhuma alteração neste arquivo</div>
            ) : (
              lines.map((line, index) => {
                if (line.kind === 'prompt') {
                  return (
                    <div
                      key={`prompt-${index}`}
                      className='git-diff-view__row git-diff-view__row--prompt'
                    >
                      <span className='git-diff-view__line-num git-diff-view__line-num--old' />
                      <span className='git-diff-view__line-num git-diff-view__line-num--new' />
                      <span className='git-diff-view__sign git-diff-view__sign--prompt'>»</span>
                      <span className='git-diff-view__content git-diff-view__content--prompt'>
                        <GitDiffPromptRow prompt={line.content} onOpen={handleOpenPromptModal} />
                      </span>
                    </div>
                  );
                }

                const changeIndex = lineIndexToChangeIndex.get(index);
                const isChangeLine = changeIndex !== undefined;

                return (
                  <div
                    key={`${line.kind}-${index}`}
                    ref={isChangeLine ? setRowRef(index) : undefined}
                    data-change-index={isChangeLine ? changeIndex : undefined}
                    className={`git-diff-view__row git-diff-view__row--${line.kind}${isChangeLine && changeIndex === currentChangeIndex ? ' git-diff-view__row--current' : ''}`}
                  >
                    <span className='git-diff-view__line-num git-diff-view__line-num--old'>
                      {line.oldLineNumber ?? ''}
                    </span>
                    <span className='git-diff-view__line-num git-diff-view__line-num--new'>
                      {line.newLineNumber ?? ''}
                    </span>
                    <span className='git-diff-view__sign'>
                      {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                    </span>
                    <span
                      className='git-diff-view__content hljs'
                      dangerouslySetInnerHTML={{
                        __html: resolveGitDiffLineHtml(line, beforeHighlights, afterHighlights) || ' ',
                      }}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
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
      {expandedPrompt ? (
        <AgentGitPromptModal prompt={expandedPrompt} onClose={handleClosePromptModal} />
      ) : null}
    </div>
  );
}

export const GitDiffView = memo(GitDiffViewComponent);
