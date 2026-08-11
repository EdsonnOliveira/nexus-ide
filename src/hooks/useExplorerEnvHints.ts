import { useEffect, useMemo, useState } from 'react';
import { EXPLORER_ROOT_COLORS, type ProjectDirectoryEntry, type ProjectKind } from '@/types';
import {
  collectExplorerEnvHintsFromEntries,
  type ExplorerEnvHint,
} from '@/utils/explorerEnvHints';

export function useExplorerEnvHints(
  rootPath: string,
  rootEntries: ProjectDirectoryEntry[],
  projectKinds: Record<string, ProjectKind | null>,
  treeRevision: number,
  enabled: boolean,
): ExplorerEnvHint[] {
  const [listedByDirectory, setListedByDirectory] = useState<
    Record<string, ProjectDirectoryEntry[]>
  >({});
  const [listingRevision, setListingRevision] = useState(0);
  const [rootKind, setRootKind] = useState<ProjectKind | null>(null);

  const directoryEntries = useMemo(
    () => rootEntries.filter((entry) => entry.type === 'directory'),
    [rootEntries],
  );

  const resolvedProjectKinds = useMemo(
    () => ({
      ...projectKinds,
      [rootPath]: projectKinds[rootPath] ?? rootKind,
    }),
    [projectKinds, rootKind, rootPath],
  );

  const badgeColorByPath = useMemo(() => {
    const colors: Record<string, string> = {};

    directoryEntries.forEach((entry, index) => {
      colors[entry.path] = EXPLORER_ROOT_COLORS[index % EXPLORER_ROOT_COLORS.length]!;
    });

    if (!colors[rootPath]) {
      colors[rootPath] = EXPLORER_ROOT_COLORS[0]!;
    }

    return colors;
  }, [directoryEntries, rootPath]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return window.nexus.files.onProjectChange((payload) => {
      if (payload.projectPath !== rootPath) {
        return;
      }

      setListingRevision((value) => value + 1);
    });
  }, [enabled, rootPath]);

  useEffect(() => {
    if (!enabled) {
      setRootKind(null);
      return;
    }

    let cancelled = false;

    void window.nexus.files
      .detectProjectKinds([rootPath])
      .then((kinds) => {
        if (!cancelled) {
          setRootKind(kinds[rootPath] ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRootKind(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, rootPath, treeRevision]);

  useEffect(() => {
    if (!enabled) {
      setListedByDirectory({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      const nextListed: Record<string, ProjectDirectoryEntry[]> = {
        [rootPath]: rootEntries,
      };

      await Promise.all(
        directoryEntries.map(async (directory) => {
          try {
            nextListed[directory.path] = await window.nexus.files.listDirectoryEntries(
              directory.path,
            );
          } catch {
            nextListed[directory.path] = [];
          }
        }),
      );

      if (!cancelled) {
        setListedByDirectory(nextListed);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [directoryEntries, enabled, listingRevision, rootEntries, rootPath, treeRevision]);

  return useMemo(() => {
    if (!enabled) {
      return [];
    }

    return collectExplorerEnvHintsFromEntries({
      rootPath,
      rootEntries,
      directoryEntries,
      projectKinds: resolvedProjectKinds,
      badgeColorByPath,
      listedByDirectory,
    });
  }, [
    badgeColorByPath,
    directoryEntries,
    enabled,
    listedByDirectory,
    resolvedProjectKinds,
    rootEntries,
    rootPath,
  ]);
}
