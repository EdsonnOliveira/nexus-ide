import {
  createContext,
  lazy,
  memo,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DailyGenerateDateMenu } from '@/components/home/DailyGenerateDateMenu';

const DailyAgentResultModal = lazy(() =>
  import('@/components/home/DailyAgentResultModal').then((module) => ({
    default: module.DailyAgentResultModal,
  })),
);
import { useDailyAgentGeneration } from '@/hooks/useDailyAgentGeneration';
import { useHomeDashboardDailySkill } from '@/hooks/useHomeDashboardDailySkill';
import { fetchProjectGitFlatChanges } from '@/hooks/useProjectGitFlatChanges';
import { useAgentGitChangeStore } from '@/stores/useAgentGitChangeStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import {
  loadProjectLinkedTranscriptions,
  type LinkedTranscriptionSummary,
} from '@/utils/brainTranscriptionLinks';
import type { GitFlatChange } from '@/utils/gitFlatChanges';

interface ExternalDailyDateMenuState {
  projectId: string;
  anchorRect: DOMRect;
}

interface DailyGenerationContextValue {
  skillOptions: ReturnType<typeof useHomeDashboardDailySkill>['skillOptions'];
  selectedSkillId: string;
  selectedSkill: ReturnType<typeof useHomeDashboardDailySkill>['selectedSkill'];
  selectSkillById: ReturnType<typeof useHomeDashboardDailySkill>['selectSkillById'];
  loadingSkills: boolean;
  isSkillAvailableForProject: ReturnType<typeof useHomeDashboardDailySkill>['isSkillAvailableForProject'];
  runningProjectId: string | null;
  hasCachedResult: (projectId: string) => boolean;
  generateForProject: (
    project: Project,
    groups: AgentGitChangeGroup[],
    gitChanges: GitFlatChange[],
    transcriptions: LinkedTranscriptionSummary[],
    targetDate: Date,
  ) => void;
  viewCached: (projectId: string) => void;
  openDailyDateMenu: (projectId: string, x: number, y: number) => void;
}

const DailyGenerationContext = createContext<DailyGenerationContextValue | null>(null);

function anchorRectFromPoint(x: number, y: number): DOMRect {
  return new DOMRect(x, y, 1, 1);
}

async function resolveDailyProjectContext(projectId: string): Promise<{
  project: Project;
  visibleGroups: AgentGitChangeGroup[];
  gitChanges: GitFlatChange[];
  transcriptions: LinkedTranscriptionSummary[];
} | null> {
  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

  if (!project) {
    return null;
  }

  const groups = useAgentGitChangeStore.getState().groupsByProject[projectId] ?? [];
  const visibleGroups = groups.filter((group) => group.files.length > 0);
  const [gitChanges, transcriptions] = await Promise.all([
    visibleGroups.length > 0 ? Promise.resolve([]) : fetchProjectGitFlatChanges(project.path),
    loadProjectLinkedTranscriptions(project.path),
  ]);

  return {
    project,
    visibleGroups,
    gitChanges,
    transcriptions,
  };
}

function DailyGenerationProviderComponent({ children }: { children: ReactNode }) {
  const projects = useProjectStore((state) => state.projects);
  const {
    skillOptions,
    selectedSkillId,
    selectedSkill,
    selectSkillById,
    loadingSkills,
    isSkillAvailableForProject,
  } = useHomeDashboardDailySkill(projects);
  const {
    runningProjectId,
    resultModal,
    hasCachedResult,
    generate,
    viewCached,
    regenerate,
    closeModal,
  } = useDailyAgentGeneration(projects);
  const [externalDateMenu, setExternalDateMenu] = useState<ExternalDailyDateMenuState | null>(null);

  const generateForProject = useCallback(
    (
      project: Project,
      groups: AgentGitChangeGroup[],
      gitChanges: GitFlatChange[],
      transcriptions: LinkedTranscriptionSummary[],
      targetDate: Date,
    ) => {
      if (!selectedSkill || !isSkillAvailableForProject(project.path)) {
        return;
      }

      void generate({
        project,
        skill: selectedSkill,
        groups,
        gitChanges,
        transcriptions,
        targetDate,
      });
    },
    [generate, isSkillAvailableForProject, selectedSkill],
  );

  const openDailyDateMenu = useCallback((projectId: string, x: number, y: number) => {
    setExternalDateMenu({
      projectId,
      anchorRect: anchorRectFromPoint(x, y),
    });
  }, []);

  const handleExternalDateMenuClose = useCallback(() => {
    setExternalDateMenu(null);
  }, []);

  const handleExternalDateSelect = useCallback(
    (targetDate: Date) => {
      if (!externalDateMenu) {
        return;
      }

      void resolveDailyProjectContext(externalDateMenu.projectId).then((context) => {
        if (!context) {
          return;
        }

        generateForProject(
          context.project,
          context.visibleGroups,
          context.gitChanges,
          context.transcriptions,
          targetDate,
        );
      });

      setExternalDateMenu(null);
    },
    [externalDateMenu, generateForProject],
  );

  const value = useMemo(
    () => ({
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
      openDailyDateMenu,
    }),
    [
      generateForProject,
      hasCachedResult,
      isSkillAvailableForProject,
      loadingSkills,
      openDailyDateMenu,
      runningProjectId,
      selectSkillById,
      selectedSkill,
      selectedSkillId,
      skillOptions,
      viewCached,
    ],
  );

  return (
    <DailyGenerationContext.Provider value={value}>
      {children}
      {resultModal ? (
        <Suspense fallback={null}>
          <DailyAgentResultModal
            modal={resultModal}
            isRunning={runningProjectId === resultModal.project.id}
            onClose={closeModal}
            onRegenerate={regenerate}
          />
        </Suspense>
      ) : null}
      {externalDateMenu ? (
        <DailyGenerateDateMenu
          anchorRect={externalDateMenu.anchorRect}
          onClose={handleExternalDateMenuClose}
          onSelect={handleExternalDateSelect}
        />
      ) : null}
    </DailyGenerationContext.Provider>
  );
}

export const DailyGenerationProvider = memo(DailyGenerationProviderComponent);

export function useDailyGeneration(): DailyGenerationContextValue {
  const context = useContext(DailyGenerationContext);

  if (!context) {
    throw new Error('useDailyGeneration must be used within DailyGenerationProvider');
  }

  return context;
}
