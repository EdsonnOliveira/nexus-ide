import { Sparkles, BookOpen, FolderKanban } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import { DailyProjectPickerModal } from '@/components/home/DailyProjectPickerModal';
import { HomeDashboardSection } from '@/components/home/HomeDashboardSection';
import { HomeDashboardDailyProjectRow } from '@/components/home/HomeDashboardDailyProjectRow';
import { useDailyGeneration } from '@/components/home/DailyGenerationProvider';
import {
  HomeDashboardDailySkeleton,
  HomeDashboardSelectSkeleton,
} from '@/components/home/HomeDashboardSkeletons';
import { useHomeDashboardDailyProjects } from '@/hooks/useHomeDashboardDailyProjects';
import type { Project } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { GitFlatChange } from '@/utils/gitFlatChanges';

interface HomeDashboardDailyCardProps {
  projects: Project[];
  enterDelayMs?: number;
}

function HomeDashboardDailyCardComponent({
  projects,
  enterDelayMs = 40,
}: HomeDashboardDailyCardProps) {
  const {
    skillOptions,
    selectedSkillId,
    selectedSkill,
    selectSkillById,
    loadingSkills,
    isSkillAvailableForProject,
    runningProjectId,
    hasCachedResult,
    generateForProject,
    viewCached,
  } = useDailyGeneration();
  const { selectedProjectIds, visibleDailyProjects, setSelectedProjectIds } =
    useHomeDashboardDailyProjects(projects);
  const [pickerOpen, setPickerOpen] = useState(false);

  const dailySkillIcon = useMemo(
    () => <BookOpen size={14} strokeWidth={2} className='home-dashboard__daily-skill-icon' />,
    [],
  );

  const dailySkillOptions = useMemo(
    () =>
      skillOptions.map((option) => ({
        ...option,
        icon: dailySkillIcon,
      })),
    [dailySkillIcon, skillOptions],
  );

  const handleOpenPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const handleClosePicker = useCallback(() => {
    setPickerOpen(false);
  }, []);

  const handleApplyProjects = useCallback(
    (projectIds: string[]) => {
      setSelectedProjectIds(projectIds);
    },
    [setSelectedProjectIds],
  );

  const headerActions = useMemo(
    () => (
      <div className='home-dashboard__daily-header-actions'>
        <button
          type='button'
          className='home-dashboard__daily-projects-btn app-button app-button--enter'
          onClick={handleOpenPicker}
        >
          <FolderKanban size={14} strokeWidth={2} />
          <span>Selecionar projetos</span>
        </button>
        {loadingSkills ? (
          <HomeDashboardSelectSkeleton />
        ) : (
          <AnchoredSelect
            value={selectedSkillId}
            options={dailySkillOptions}
            allowEmpty
            emptyLabel='Selecionar skill'
            disabled={skillOptions.length === 0}
            leadingIcon={dailySkillIcon}
            onChange={selectSkillById}
            triggerClassName='home-dashboard__daily-select'
          />
        )}
      </div>
    ),
    [
      dailySkillIcon,
      dailySkillOptions,
      handleOpenPicker,
      loadingSkills,
      selectSkillById,
      selectedSkillId,
      skillOptions.length,
    ],
  );

  const handleGenerate = useCallback(
    (
      project: Project,
      groups: AgentGitChangeGroup[],
      gitChanges: GitFlatChange[],
      targetDate: Date,
    ) => {
      if (!selectedSkill) {
        return;
      }

      generateForProject(project, groups, gitChanges, targetDate);
    },
    [generateForProject, selectedSkill],
  );

  const handleView = useCallback(
    (project: Project) => {
      viewCached(project.id);
    },
    [viewCached],
  );

  const showSkeleton = loadingSkills && visibleDailyProjects.length > 0;

  const sortedProjects = useMemo(
    () =>
      [...visibleDailyProjects].sort((left, right) => {
        const leftCached = hasCachedResult(left.id);
        const rightCached = hasCachedResult(right.id);

        if (leftCached === rightCached) {
          return 0;
        }

        return leftCached ? -1 : 1;
      }),
    [hasCachedResult, visibleDailyProjects],
  );

  const emptyMessage =
    projects.length === 0
      ? 'Nenhum projeto neste workspace'
      : 'Nenhum projeto selecionado para o Daily';

  return (
    <>
      <HomeDashboardSection
        icon={Sparkles}
        title='Daily'
        accent='#fbbf24'
        className='home-dashboard__daily-section'
        enterDelayMs={enterDelayMs}
        headerAction={headerActions}
      >
        {showSkeleton ? (
          <HomeDashboardDailySkeleton />
        ) : sortedProjects.length === 0 ? (
          <EmptyState icon={Sparkles} message={emptyMessage} compact />
        ) : (
          <div className='home-dashboard__daily-list'>
            {sortedProjects.map((project, index) => (
              <HomeDashboardDailyProjectRow
                key={project.id}
                project={project}
                enterDelayMs={enterDelayMs + 40 + index * 35}
                selectedSkill={selectedSkill}
                isSkillAvailable={isSkillAvailableForProject(project.path)}
                isRunning={runningProjectId === project.id}
                isAnyRunning={runningProjectId !== null}
                hasCachedResult={hasCachedResult(project.id)}
                onView={handleView}
                onGenerate={handleGenerate}
              />
            ))}
          </div>
        )}
      </HomeDashboardSection>
      {pickerOpen ? (
        <DailyProjectPickerModal
          projects={projects}
          selectedProjectIds={selectedProjectIds}
          onClose={handleClosePicker}
          onApply={handleApplyProjects}
        />
      ) : null}
    </>
  );
}

export const HomeDashboardDailyCard = memo(HomeDashboardDailyCardComponent);
