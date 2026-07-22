import { Eye, Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DailyGenerateDateMenu } from '@/components/home/DailyGenerateDateMenu';
import { DailyProjectDetailModal } from '@/components/home/DailyProjectDetailModal';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { useProjectGitFlatChanges } from '@/hooks/useProjectGitFlatChanges';
import { useAgentGitGroupsForProject } from '@/stores/useAgentGitChangeStore';
import type { Project, TerminalCommandHint } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import {
  loadProjectLinkedTranscriptions,
  type LinkedTranscriptionSummary,
} from '@/utils/brainTranscriptionLinks';
import type { GitFlatChange } from '@/utils/gitFlatChanges';
import { buildDailyProjectMetaLabel } from '@/utils/buildDailyProjectMetaLabel';

interface HomeDashboardDailyProjectRowProps {
  project: Project;
  enterDelayMs?: number;
  selectedSkill: TerminalCommandHint | null;
  isSkillAvailable: boolean;
  isRunning: boolean;
  isAnyRunning: boolean;
  hasCachedResult: boolean;
  onView: (project: Project) => void;
  onGenerate: (
    project: Project,
    groups: AgentGitChangeGroup[],
    gitChanges: GitFlatChange[],
    transcriptions: LinkedTranscriptionSummary[],
    targetDate: Date,
  ) => void;
}

function HomeDashboardDailyProjectRowComponent({
  project,
  enterDelayMs = 0,
  selectedSkill,
  isSkillAvailable,
  isRunning,
  isAnyRunning,
  hasCachedResult,
  onView,
  onGenerate,
}: HomeDashboardDailyProjectRowProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [generateMenuOpen, setGenerateMenuOpen] = useState(false);
  const [generateMenuAnchor, setGenerateMenuAnchor] = useState<DOMRect | null>(null);
  const [transcriptions, setTranscriptions] = useState<LinkedTranscriptionSummary[]>([]);
  const [transcriptionsLoading, setTranscriptionsLoading] = useState(true);
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const groups = useAgentGitGroupsForProject(project.id);
  const { changes: gitChanges, loading: gitLoading } = useProjectGitFlatChanges(project.path);

  const visibleGroups = useMemo(
    () => groups.filter((group) => group.files.length > 0),
    [groups],
  );

  const hasPromptGroups = visibleGroups.length > 0;
  const fallbackGitChanges = useMemo(
    () => (hasPromptGroups ? [] : gitChanges),
    [gitChanges, hasPromptGroups],
  );
  const hasGitChanges = fallbackGitChanges.length > 0;
  const hasTranscriptions = transcriptions.length > 0;

  const metaLabel = useMemo(
    () =>
      buildDailyProjectMetaLabel({
        groups: visibleGroups,
        gitChanges: fallbackGitChanges,
        gitLoading,
        transcriptionCount: transcriptions.length,
        transcriptionsLoading,
      }),
    [fallbackGitChanges, gitLoading, transcriptions.length, transcriptionsLoading, visibleGroups],
  );

  useEffect(() => {
    let cancelled = false;

    setTranscriptionsLoading(true);

    void loadProjectLinkedTranscriptions(project.path)
      .then((items) => {
        if (cancelled) {
          return;
        }

        setTranscriptions(items);
      })
      .finally(() => {
        if (!cancelled) {
          setTranscriptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project.path]);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!project.logo || !window.nexus) {
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
  }, [project.logo]);

  const handleOpenDetail = useCallback(() => {
    setDetailOpen(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  const handleGenerateClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();

      if (hasCachedResult && !isAnyRunning) {
        onView(project);
        return;
      }

      const button = generateButtonRef.current;

      if (!button) {
        return;
      }

      setGenerateMenuAnchor(button.getBoundingClientRect());
      setGenerateMenuOpen(true);
    },
    [hasCachedResult, isAnyRunning, onView, project],
  );

  const handleGenerateMenuClose = useCallback(() => {
    setGenerateMenuOpen(false);
    setGenerateMenuAnchor(null);
  }, []);

  const handleGenerateDateSelect = useCallback(
    (targetDate: Date) => {
      onGenerate(project, visibleGroups, fallbackGitChanges, transcriptions, targetDate);
      handleGenerateMenuClose();
    },
    [
      fallbackGitChanges,
      handleGenerateMenuClose,
      onGenerate,
      project,
      transcriptions,
      visibleGroups,
    ],
  );

  const showLogo = Boolean(logoSrc) && !logoFailed;

  const showViewAction = hasCachedResult && !isRunning;
  const actionLabel = showViewAction ? 'Ver' : 'Gerar';

  const generateDisabled = showViewAction
    ? isAnyRunning
    : !selectedSkill || !isSkillAvailable || isAnyRunning;

  const generateTitle = showViewAction
    ? `Ver daily gerado para ${project.name}`
    : !selectedSkill
      ? 'Selecione uma skill no card Daily'
      : !isSkillAvailable
        ? 'Skill indisponível neste projeto'
        : isAnyRunning
          ? 'Aguarde a geração atual'
          : 'Escolher a data para gerar';

  return (
    <>
      <article
        className='home-dashboard__daily-project app-button--enter'
        style={{ animationDelay: `${enterDelayMs}ms`, ['--project-accent' as string]: project.color }}
      >
        <div className='home-dashboard__daily-project-head'>
          <button
            type='button'
            className='home-dashboard__daily-project-toggle app-button'
            aria-haspopup='dialog'
            onClick={handleOpenDetail}
          >
            <span className='home-dashboard__daily-project-icon-wrap' aria-hidden='true'>
              {showLogo ? (
                <img src={logoSrc ?? undefined} alt='' className='home-dashboard__daily-project-logo' />
              ) : (
                <span
                  className='home-dashboard__daily-project-icon'
                  style={{ backgroundColor: project.color }}
                >
                  <ProjectIconMark icon={project.icon} />
                </span>
              )}
            </span>
            <span className='home-dashboard__daily-project-copy'>
              <span className='home-dashboard__daily-project-name'>{project.name}</span>
              <span className='home-dashboard__daily-project-meta'>{metaLabel}</span>
            </span>
          </button>
          <button
            ref={generateButtonRef}
            type='button'
            className={`home-dashboard__daily-generate app-button app-button--enter${generateMenuOpen ? ' home-dashboard__daily-generate--open' : ''}${showViewAction ? ' home-dashboard__daily-generate--view' : ''}`}
            disabled={generateDisabled}
            title={generateTitle}
            aria-label={showViewAction ? `Ver daily de ${project.name}` : `Gerar daily para ${project.name}`}
            aria-expanded={generateMenuOpen}
            aria-haspopup={showViewAction ? undefined : 'menu'}
            onClick={handleGenerateClick}
          >
            {isRunning ? <Loader2 size={14} className='home-dashboard__daily-modal-spinner' /> : null}
            {!isRunning && showViewAction ? <Eye size={14} strokeWidth={2.25} /> : null}
            <span>{actionLabel}</span>
          </button>
        </div>
        {generateMenuOpen && generateMenuAnchor ? (
          <DailyGenerateDateMenu
            anchorRect={generateMenuAnchor}
            triggerRef={generateButtonRef}
            onClose={handleGenerateMenuClose}
            onSelect={handleGenerateDateSelect}
          />
        ) : null}
      </article>
      {detailOpen ? (
        <DailyProjectDetailModal
          project={project}
          metaLabel={metaLabel}
          visibleGroups={visibleGroups}
          fallbackGitChanges={fallbackGitChanges}
          gitLoading={gitLoading}
          hasPromptGroups={hasPromptGroups}
          hasGitChanges={hasGitChanges}
          transcriptions={transcriptions}
          transcriptionsLoading={transcriptionsLoading}
          hasTranscriptions={hasTranscriptions}
          onClose={handleCloseDetail}
        />
      ) : null}
    </>
  );
}

export const HomeDashboardDailyProjectRow = memo(HomeDashboardDailyProjectRowComponent);
