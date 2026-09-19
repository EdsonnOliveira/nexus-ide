import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen } from 'lucide-react';
import { ExplorerDirectoryIcon } from '@/components/explorer/ExplorerTreeIcon';
import { EmptyState } from '@/components/overlay/EmptyState';
import {
  positionDropdownAfterAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import {
  getProjectKindBadgeLabel,
  PROJECT_KIND_BADGE_COLORS,
  resolveProjectKindBadge,
} from '@/utils/explorerEnvHints';
import type { Project, ProjectDirectoryEntry, ProjectKind } from '@/types';

interface SidebarProjectFoldersPopupProps {
  project: Project;
  anchorRect: DOMRect;
  onClose: () => void;
  onPointerInsideChange: (inside: boolean) => void;
  onSelectFolder: (folderPath: string) => void;
}

function SidebarProjectFoldersPopupComponent({
  project,
  anchorRect,
  onClose,
  onPointerInsideChange,
  onSelectFolder,
}: SidebarProjectFoldersPopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAfterAnchor(menu, anchorRect),
    [anchorRect],
    'dropdown',
    { closeOthers: false },
  );
  const [folders, setFolders] = useState<ProjectDirectoryEntry[]>([]);
  const [projectKinds, setProjectKinds] = useState<Record<string, ProjectKind | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      if (!window.nexus?.files?.listDirectoryEntries) {
        if (!cancelled) {
          setFolders([]);
          setProjectKinds({});
          setLoading(false);
        }

        return;
      }

      try {
        const entries = await window.nexus.files.listDirectoryEntries(project.path);
        const nextFolders = entries.filter((entry) => entry.type === 'directory');
        const directoryPaths = nextFolders.map((entry) => entry.path);
        let kinds: Record<string, ProjectKind | null> = {};

        try {
          kinds =
            directoryPaths.length > 0
              ? await window.nexus.files.detectProjectKinds(directoryPaths)
              : {};
        } catch {
          kinds = {};
        }

        if (!cancelled) {
          setFolders(nextFolders);
          setProjectKinds(kinds);
        }
      } catch {
        if (!cancelled) {
          setFolders([]);
          setProjectKinds({});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project.path]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
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
  }, [menuRef, requestClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [requestClose]);

  const handleSelectFolder = useCallback(
    (folderPath: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectFolder(folderPath);
      requestClose();
    },
    [onSelectFolder, requestClose],
  );

  const listContent = useMemo(() => {
    if (loading) {
      return (
        <div className='sidebar-project-folders-popup__skeleton' aria-hidden='true'>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className='sidebar-project-folders-popup__skeleton-row' />
          ))}
        </div>
      );
    }

    if (folders.length === 0) {
      return (
        <EmptyState
          icon={FolderOpen}
          message='Nenhuma pasta na raiz'
          compact
          className='sidebar-project-folders-popup__empty'
        />
      );
    }

    return (
      <div className='sidebar-project-folders-popup__list'>
        {folders.map((folder) => {
          const projectKind = resolveProjectKindBadge(
            folder.name,
            projectKinds[folder.path] ?? null,
          );
          const badgeColor = projectKind ? PROJECT_KIND_BADGE_COLORS[projectKind] : undefined;

          return (
            <button
              key={folder.path}
              type='button'
              className='context-menu__item app-button app-button--enter sidebar-project-folders-popup__item'
              onMouseDown={handleSelectFolder(folder.path)}
            >
              <span className='sidebar-project-folders-popup__icon'>
                <ExplorerDirectoryIcon folderName={folder.name} expanded={false} />
              </span>
              {projectKind ? (
                <span
                  className='project-explorer__kind-badge sidebar-project-folders-popup__badge'
                  style={{ backgroundColor: badgeColor, color: '#000000' }}
                >
                  {getProjectKindBadgeLabel(projectKind)}
                </span>
              ) : null}
              <span className='sidebar-project-folders-popup__name' title={folder.name}>
                {folder.name}
              </span>
            </button>
          );
        })}
      </div>
    );
  }, [folders, handleSelectFolder, loading, projectKinds]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup sidebar-project-folders-popup overlay-popup--anchor-start ${animationClass}`}
      role='menu'
      aria-label={`Pastas de ${project.name}`}
      onMouseEnter={() => onPointerInsideChange(true)}
      onMouseLeave={() => onPointerInsideChange(false)}
    >
      <div className='sidebar-project-folders-popup__header'>{project.name}</div>
      {listContent}
    </div>,
    document.body,
  );
}

export const SidebarProjectFoldersPopup = memo(SidebarProjectFoldersPopupComponent);
