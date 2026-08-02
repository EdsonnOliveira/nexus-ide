import { createContext, useContext } from 'react';
import type { useHomeDashboardDailySkill } from '@/hooks/useHomeDashboardDailySkill';
import type { Project } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { LinkedTranscriptionSummary } from '@/utils/brainTranscriptionLinks';
import type { GitFlatChange } from '@/utils/gitFlatChanges';

export interface DailyGenerationContextValue {
  skillOptions: ReturnType<typeof useHomeDashboardDailySkill>['skillOptions'];
  selectedSkillId: string;
  selectedSkill: ReturnType<typeof useHomeDashboardDailySkill>['selectedSkill'];
  selectSkillById: ReturnType<typeof useHomeDashboardDailySkill>['selectSkillById'];
  loadingSkills: boolean;
  isSkillAvailableForProject: ReturnType<
    typeof useHomeDashboardDailySkill
  >['isSkillAvailableForProject'];
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

export const DailyGenerationContext = createContext<DailyGenerationContextValue | null>(null);

export function useDailyGeneration(): DailyGenerationContextValue {
  const context = useContext(DailyGenerationContext);

  if (!context) {
    throw new Error('useDailyGeneration must be used within DailyGenerationProvider');
  }

  return context;
}
