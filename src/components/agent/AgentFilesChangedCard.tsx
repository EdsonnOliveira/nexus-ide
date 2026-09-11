import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { FileCode2, FileWarning, GitBranch, Image } from 'lucide-react';
import { ExplorerFileIcon } from '@/components/explorer/ExplorerTreeIcon';
import { EmptyState } from '@/components/overlay/EmptyState';
import {
  positionDropdownAboveAnchor,
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useTabActions } from '@/stores/useTabStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentTurnSummaryFileRef, AgentTurnUsage } from '@/types';
import { resolveAgentActivityFilePath } from '@/utils/agentTranscriptParser';
import { formatAgentContextTokens } from '@/utils/agentContextUsageParser';
import { loadAgentFileDiffPreview, type AgentFileDiffPreview } from '@/utils/agentGitDiff';
import { highlightCodeLines } from '@/utils/codeHighlight';
import { buildFlatChanges } from '@/utils/gitFlatChanges';
import type { GitDiffPreviewHunk } from '@/utils/gitDiffLines';
import {
  findGitFlatChangeByPath,
  resolveGitRepoPathForFile,
  toGitRelativePath,
} from '@/utils/gitPaths';

export interface AgentFilesChangedCardProps {
  files: AgentTurnSummaryFileRef[];
  projectPath: string;
  startedAt?: number;
  completedAt?: number;
  usage?: AgentTurnUsage;
  onReview?: () => void;
  showReview?: boolean;
  disableProjectOpen?: boolean;
}

interface PreviewAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface ActiveFileDiffPreview {
  path: string;
  additions: number;
  deletions: number;
  anchor: PreviewAnchor;
}

const PREVIEW_OPEN_DELAY_MS = 1000;
const PREVIEW_LEAVE_GRACE_MS = 140;

function fileDiffPreviewCacheKey(file: {
  path: string;
  additions?: number;
  deletions?: number;
}): string {
  return `${file.path}\0${file.additions ?? 0}\0${file.deletions ?? 0}`;
}

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? path;
}

function rectToAnchor(rect: DOMRect): PreviewAnchor {
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function resolveTurnTokenCount(usage?: AgentTurnUsage): number | null {
  if (!usage) {
    return null;
  }

  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;

  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return total;
}

function formatAgentWorkDuration(startedAt?: number, completedAt?: number): string | null {
  if (!startedAt || !Number.isFinite(startedAt) || startedAt <= 0) {
    return null;
  }

  const endAt =
    completedAt && Number.isFinite(completedAt) && completedAt >= startedAt ? completedAt : null;

  if (!endAt) {
    return null;
  }

  const totalSeconds = Math.max(1, Math.round((endAt - startedAt) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function highlightPreviewHunks(
  hunks: GitDiffPreviewHunk[],
  filePath: string,
): GitDiffPreviewHunk[] {
  return hunks.map((hunk) => ({
    lines: hunk.lines.map((line) => {
      const highlighted = highlightCodeLines(line.content, filePath)[0] ?? line.content;

      return {
        ...line,
        content: highlighted.length > 0 ? highlighted : ' ',
      };
    }),
  }));
}

interface AgentFilesChangedDiffPreviewProps {
  preview: ActiveFileDiffPreview;
  projectPath: string;
  cache: Map<string, AgentFileDiffPreview>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function AgentFilesChangedDiffPreviewComponent({
  preview,
  projectPath,
  cache,
  onMouseEnter,
  onMouseLeave,
}: AgentFilesChangedDiffPreviewProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<AgentFileDiffPreview | null>(
    () => cache.get(fileDiffPreviewCacheKey(preview)) ?? null,
  );
  const [loading, setLoading] = useState(!cache.has(fileDiffPreviewCacheKey(preview)));

  useEffect(() => {
    const cacheKey = fileDiffPreviewCacheKey(preview);
    const cached = cache.get(cacheKey);

    if (cached) {
      setResult(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setResult(null);

    void loadAgentFileDiffPreview(projectPath, preview.path).then((next) => {
      if (cancelled) {
        return;
      }

      cache.set(cacheKey, next);
      setResult(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cache, preview.additions, preview.deletions, preview.path, projectPath]);

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    positionDropdownAboveAnchor(menu, preview.anchor as DOMRect, 'start');
  }, [loading, preview.anchor, result]);

  useEffect(() => {
    const menu = menuRef.current;

    const closeOnOutsideScroll = (event: Event) => {
      const target = event.target;

      if (target instanceof Node && menu?.contains(target)) {
        return;
      }

      onMouseLeave();
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onMouseLeave();
      }
    };

    window.addEventListener('scroll', closeOnOutsideScroll, true);
    window.addEventListener('resize', closeOnOutsideScroll);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('scroll', closeOnOutsideScroll, true);
      window.removeEventListener('resize', closeOnOutsideScroll);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onMouseLeave]);

  const highlightedHunks = useMemo(() => {
    if (!result || result.kind !== 'ok') {
      return [];
    }

    return highlightPreviewHunks(result.hunks, result.displayPath);
  }, [result]);

  const emptyState = useMemo(() => {
    if (loading || !result || result.kind === 'ok') {
      return null;
    }

    if (result.kind === 'image') {
      return { icon: Image, message: 'Prévia indisponível para imagens' };
    }

    if (result.kind === 'binary') {
      return { icon: FileCode2, message: 'Arquivo binário — sem prévia de código' };
    }

    if (result.kind === 'large') {
      return { icon: FileCode2, message: 'Arquivo grande demais para prévia' };
    }

    if (result.kind === 'error') {
      return { icon: FileWarning, message: 'Não foi possível carregar as alterações' };
    }

    return { icon: FileCode2, message: 'Nenhuma alteração neste arquivo' };
  }, [loading, result]);

  const displayPath = result?.displayPath || preview.path;
  const additions = preview.additions;
  const deletions = preview.deletions;

  return createPortal(
    <div
      ref={menuRef}
      className='agent-view__files-changed-preview overlay-popup overlay-popup--in'
      role='tooltip'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className='agent-view__files-changed-preview-header'>
        <span className='agent-view__files-changed-preview-path'>{displayPath}</span>
        <span className='agent-view__files-changed-diff'>
          {additions > 0 ? (
            <span className='agent-view__files-changed-add'>+{additions}</span>
          ) : null}
          {deletions > 0 ? (
            <span className='agent-view__files-changed-del'>-{deletions}</span>
          ) : null}
        </span>
      </div>
      {loading ? (
        <div className='agent-view__files-changed-preview-loading' aria-hidden='true' />
      ) : emptyState ? (
        <EmptyState
          icon={emptyState.icon}
          message={emptyState.message}
          compact
          className='agent-view__files-changed-preview-empty'
        />
      ) : (
        <div className='agent-view__files-changed-preview-body'>
          {highlightedHunks.map((hunk, hunkIndex) => (
            <div key={`hunk-${hunkIndex}`} className='agent-view__files-changed-preview-hunk'>
              {hunk.lines.map((line, lineIndex) => (
                <div
                  key={`${hunkIndex}-${lineIndex}-${line.lineNumber}`}
                  className={`agent-view__files-changed-preview-line agent-view__files-changed-preview-line--${line.kind}`}
                >
                  <span
                    className={`agent-view__files-changed-preview-gutter agent-view__files-changed-preview-gutter--${line.kind}`}
                    aria-hidden='true'
                  />
                  <span className='agent-view__files-changed-preview-num' aria-hidden='true'>
                    {line.lineNumber > 0 ? line.lineNumber : ''}
                  </span>
                  <code
                    className='agent-view__files-changed-preview-code hljs'
                    dangerouslySetInnerHTML={{ __html: line.content }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

const AgentFilesChangedDiffPreview = memo(AgentFilesChangedDiffPreviewComponent);

function AgentFilesChangedCardComponent({
  files,
  projectPath,
  startedAt,
  completedAt,
  usage,
  onReview,
  showReview = true,
  disableProjectOpen = false,
}: AgentFilesChangedCardProps) {
  const { openDiffTab } = useTabActions();
  const openExplorerGit = useProjectStore((state) => state.openExplorerGit);
  const [activePreview, setActivePreview] = useState<ActiveFileDiffPreview | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const previewCacheRef = useRef<Map<string, AgentFileDiffPreview>>(new Map());

  const visibleFiles = useMemo(() => files.filter((file) => file.path.trim()), [files]);
  const filesSignature = useMemo(
    () => visibleFiles.map((file) => fileDiffPreviewCacheKey(file)).join('|'),
    [visibleFiles],
  );

  useEffect(() => {
    previewCacheRef.current.clear();
  }, [filesSignature]);

  const tokenCount = useMemo(() => resolveTurnTokenCount(usage), [usage]);
  const workDurationLabel = useMemo(
    () => formatAgentWorkDuration(startedAt, completedAt),
    [completedAt, startedAt],
  );
  const metaParts = useMemo(() => {
    const parts: string[] = [];

    if (tokenCount !== null) {
      parts.push(`${formatAgentContextTokens(tokenCount)} tokens`);
    }

    if (workDurationLabel) {
      parts.push(workDurationLabel);
    }

    return parts;
  }, [tokenCount, workDurationLabel]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const closePreview = useCallback(() => {
    clearHoverTimer();
    clearLeaveTimer();
    setActivePreview(null);
  }, [clearHoverTimer, clearLeaveTimer]);

  const handlePreviewEnter = useCallback(() => {
    clearLeaveTimer();
  }, [clearLeaveTimer]);

  const handlePreviewLeave = useCallback(() => {
    closePreview();
  }, [closePreview]);

  useEffect(() => {
    return () => {
      clearHoverTimer();
      clearLeaveTimer();
    };
  }, [clearHoverTimer, clearLeaveTimer]);

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      const trimmed = filePath.trim();

      if (!trimmed) {
        return;
      }

      closePreview();

      if (disableProjectOpen) {
        return;
      }

      openExplorerGit();
      const absolutePath = resolveAgentActivityFilePath(projectPath, trimmed);
      const diffTargetPath = absolutePath || trimmed;

      if (!diffTargetPath) {
        return;
      }

      const repoPath = await resolveGitRepoPathForFile(projectPath, diffTargetPath);

      let staged = false;
      let untracked = false;

      let openPath = diffTargetPath;

      try {
        const status = await window.nexus.git.getStatus(repoPath);
        const relativePath = toGitRelativePath(repoPath, diffTargetPath);
        const change = findGitFlatChangeByPath(buildFlatChanges(status), relativePath);

        if (change) {
          staged = change.staged;
          untracked = change.status === 'untracked';
          openPath = change.path;
        }
      } catch {
        staged = false;
        untracked = false;
      }

      void openDiffTab(openPath, {
        staged,
        untracked,
        repoPath,
      });
    },
    [closePreview, disableProjectOpen, openDiffTab, openExplorerGit, projectPath],
  );

  const handleRowEnter = useCallback(
    (file: AgentTurnSummaryFileRef, event: ReactMouseEvent<HTMLButtonElement>) => {
      clearLeaveTimer();
      clearHoverTimer();
      setActivePreview((current) => (current && current.path !== file.path ? null : current));
      const anchor = rectToAnchor(event.currentTarget.getBoundingClientRect());
      const additions = file.additions ?? 0;
      const deletions = file.deletions ?? 0;

      hoverTimerRef.current = window.setTimeout(() => {
        setActivePreview({
          path: file.path,
          additions,
          deletions,
          anchor,
        });
      }, PREVIEW_OPEN_DELAY_MS);
    },
    [clearHoverTimer, clearLeaveTimer],
  );

  const handleRowLeave = useCallback(() => {
    clearHoverTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      setActivePreview(null);
    }, PREVIEW_LEAVE_GRACE_MS);
  }, [clearHoverTimer]);

  if (visibleFiles.length === 0) {
    return null;
  }

  const countLabel = `${visibleFiles.length} File${visibleFiles.length === 1 ? '' : 's'} Changed`;

  return (
    <div className='agent-view__files-changed app-button--enter'>
      {metaParts.length > 0 ? (
        <div className='agent-view__files-changed-meta' aria-label='Uso do agent'>
          {metaParts.map((part, index) => (
            <span key={part} className='agent-view__files-changed-meta-item'>
              {index > 0 ? (
                <span className='agent-view__files-changed-meta-sep' aria-hidden='true'>
                  ·
                </span>
              ) : null}
              <span>{part}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className='agent-view__files-changed-header'>
        <span className='agent-view__files-changed-title'>{countLabel}</span>
        {showReview && onReview ? (
          <button
            type='button'
            className='agent-view__files-changed-review app-button'
            onClick={onReview}
          >
            Review
          </button>
        ) : null}
      </div>
      <div className='agent-view__files-changed-list'>
        {visibleFiles.map((file) => {
          const fileName = getFileName(file.path);
          const additions = file.additions ?? 0;
          const deletions = file.deletions ?? 0;

          return (
            <button
              key={file.path}
              type='button'
              className='agent-view__files-changed-row app-button'
              title={file.path}
              aria-label={file.path}
              onMouseEnter={(event) => {
                handleRowEnter(file, event);
              }}
              onMouseLeave={handleRowLeave}
              onClick={(event) => {
                if (disableProjectOpen) {
                  clearHoverTimer();
                  clearLeaveTimer();
                  setActivePreview({
                    path: file.path,
                    additions,
                    deletions,
                    anchor: rectToAnchor(event.currentTarget.getBoundingClientRect()),
                  });
                  return;
                }

                void handleOpenFile(file.path);
              }}
            >
              <span className='agent-view__files-changed-icon' aria-hidden='true'>
                <ExplorerFileIcon name={fileName} />
              </span>
              <span className='agent-view__files-changed-name'>{fileName}</span>
              <span className='agent-view__files-changed-diff'>
                {additions > 0 ? (
                  <span className='agent-view__files-changed-add'>+{additions}</span>
                ) : null}
                {deletions > 0 ? (
                  <span className='agent-view__files-changed-del'>-{deletions}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {activePreview ? (
        <AgentFilesChangedDiffPreview
          preview={activePreview}
          projectPath={projectPath}
          cache={previewCacheRef.current}
          onMouseEnter={handlePreviewEnter}
          onMouseLeave={handlePreviewLeave}
        />
      ) : null}
    </div>
  );
}

export const AgentFilesChangedCard = memo(AgentFilesChangedCardComponent);

interface AgentFilesChangedPopupProps {
  anchorRect: DOMRect;
  anchorRef: RefObject<HTMLButtonElement | null>;
  files: AgentTurnSummaryFileRef[];
  projectPath: string;
  onClose: () => void;
}

function AgentFilesChangedPopupComponent({
  anchorRect,
  anchorRef,
  files,
  projectPath,
  onClose,
}: AgentFilesChangedPopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect, files.length],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) {
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
  }, [anchorRef, menuRef, requestClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  const countLabel =
    files.length === 1 ? '1 arquivo modificado' : `${files.length} arquivos modificados`;

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu home-dashboard__agent-git-popup overlay-popup overlay-popup--anchor-end ${animationClass}`}
      role='dialog'
      aria-label={countLabel}
    >
      {files.length === 0 ? (
        <EmptyState icon={GitBranch} message='Nenhum arquivo modificado' compact />
      ) : (
        <AgentFilesChangedCard
          files={files}
          projectPath={projectPath}
          showReview={false}
          disableProjectOpen
        />
      )}
    </div>,
    document.body,
  );
}

export const AgentFilesChangedPopup = memo(AgentFilesChangedPopupComponent);
