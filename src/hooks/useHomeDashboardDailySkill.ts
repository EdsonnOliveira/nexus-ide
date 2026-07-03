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

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function useHomeDashboardDailySkill(projects: Project[]) {
  const [skillHints, setSkillHints] = useState<TerminalCommandHint[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [skillsByProjectPath, setSkillsByProjectPath] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );

  const projectPathsKey = useMemo(
    () =>
      projects
        .map((project) => normalizeProjectPath(project.path))
        .filter(Boolean)
        .sort()
        .join('|'),
    [projects],
  );

  const globalSkillIds = useMemo(() => {
    const projectSkillSets = Array.from(skillsByProjectPath.values()).filter((set) => set.size > 0);

    if (projectSkillSets.length === 0) {
      return new Set<string>();
    }

    const shared = new Set(projectSkillSets[0]);

    for (const skillSet of projectSkillSets.slice(1)) {
      for (const skillId of shared) {
        if (!skillSet.has(skillId)) {
          shared.delete(skillId);
        }
      }
    }

    return shared;
  }, [skillsByProjectPath]);

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
            const normalizedPath = normalizeProjectPath(projectPath);

            try {
              const hints = await window.nexus.files.getAgentSkillHints(normalizedPath);
              const skillIds = new Set(
                hints.filter((hint) => hint.hintKind === 'skill').map((hint) => hint.id),
              );
              nextByProject.set(normalizedPath, skillIds);
              return hints;
            } catch {
              nextByProject.set(normalizedPath, new Set());
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
        const defaultHint = storedHint ?? nextHints[0] ?? null;

        setSelectedSkillId(defaultHint?.id ?? '');

        if (defaultHint && !storedHint) {
          writeStoredDailySkill(defaultHint.id);
        }
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
      if (!selectedSkillId || !selectedSkill) {
        return false;
      }

      const normalizedPath = normalizeProjectPath(projectPath);
      const projectSkillIds = skillsByProjectPath.get(normalizedPath);

      if (projectSkillIds?.has(selectedSkillId)) {
        return true;
      }

      return globalSkillIds.has(selectedSkillId);
    },
    [globalSkillIds, selectedSkill, selectedSkillId, skillsByProjectPath],
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
