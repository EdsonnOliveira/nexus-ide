import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, TerminalCommandHint } from '@/types';
import { mergeDailySkillHint, sortDailySkillHints } from '@/utils/sortDailySkillHints';

const STORAGE_KEY = 'nexus.home-dashboard.daily-skill';

interface StoredDailySkill {
  hintId: string;
}

function readStoredDailySkill(): StoredDailySkill | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredDailySkill;

    if (!parsed?.hintId?.trim()) {
      return null;
    }

    return { hintId: parsed.hintId.trim() };
  } catch {
    return null;
  }
}

function writeStoredDailySkill(hintId: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ hintId }));
}

function clearStoredDailySkill(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function useHomeDashboardDailySkill(projects: Project[]) {
  const [skillHints, setSkillHints] = useState<TerminalCommandHint[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [skillsByProjectPath, setSkillsByProjectPath] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );

  const projectPathsKey = useMemo(
    () => projects.map((project) => project.path).sort().join('|'),
    [projects],
  );

  useEffect(() => {
    let cancelled = false;
    const projectPaths = projectPathsKey ? projectPathsKey.split('|') : [];

    const loadSkills = async () => {
      setLoadingSkills(true);

      if (!window.nexus?.files || projectPaths.length === 0) {
        if (!cancelled) {
          setSkillHints([]);
          setSkillsByProjectPath(new Map());
          setLoadingSkills(false);
        }

        return;
      }

      try {
        const nextByProject = new Map<string, Set<string>>();
        const entries = await Promise.all(
          projectPaths.map(async (projectPath) => {
            try {
              const hints = await window.nexus.files.getAgentSkillHints(projectPath);
              const skillIds = new Set(
                hints.filter((hint) => hint.hintKind === 'skill').map((hint) => hint.id),
              );
              nextByProject.set(projectPath, skillIds);
              return hints;
            } catch {
              nextByProject.set(projectPath, new Set());
              return [];
            }
          }),
        );

        if (cancelled) {
          return;
        }

        const hintsById = new Map<string, TerminalCommandHint>();

        for (const projectHints of entries) {
          for (const hint of projectHints) {
            mergeDailySkillHint(hintsById, hint);
          }
        }

        const nextHints = sortDailySkillHints(Array.from(hintsById.values()));

        setSkillHints(nextHints);
        setSkillsByProjectPath(nextByProject);

        const stored = readStoredDailySkill();
        const storedHint = stored
          ? nextHints.find((hint) => hint.id === stored.hintId)
          : null;

        setSelectedSkillId(storedHint?.id ?? '');
      } finally {
        if (!cancelled) {
          setLoadingSkills(false);
        }
      }
    };

    void loadSkills();

    return () => {
      cancelled = true;
    };
  }, [projectPathsKey]);

  const skillOptions = useMemo(
    () => skillHints.map((hint) => ({ value: hint.id, label: hint.label })),
    [skillHints],
  );

  const selectedSkill = useMemo(
    () => skillHints.find((hint) => hint.id === selectedSkillId) ?? null,
    [selectedSkillId, skillHints],
  );

  const selectSkillById = useCallback(
    (skillId: string) => {
      if (!skillId) {
        setSelectedSkillId('');
        clearStoredDailySkill();
        return;
      }

      const match = skillHints.find((hint) => hint.id === skillId);

      if (!match) {
        return;
      }

      setSelectedSkillId(match.id);
      writeStoredDailySkill(match.id);
    },
    [skillHints],
  );

  const isSkillAvailableForProject = useCallback(
    (projectPath: string) => {
      if (!selectedSkillId) {
        return false;
      }

      return skillsByProjectPath.get(projectPath)?.has(selectedSkillId) ?? false;
    },
    [selectedSkillId, skillsByProjectPath],
  );

  return {
    skillOptions,
    selectedSkillId,
    selectedSkill,
    selectSkillById,
    loadingSkills,
    isSkillAvailableForProject,
  };
}
