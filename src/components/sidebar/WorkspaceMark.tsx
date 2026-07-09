import { memo, useCallback, useEffect, useState } from 'react';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { Workspace } from '@/types';

interface WorkspaceMarkProps {
  workspace: Workspace;
  size?: 'filter' | 'menu';
}

function WorkspaceMarkComponent({ workspace, size = 'menu' }: WorkspaceMarkProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!workspace.logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(workspace.logo).then((dataUrl) => {
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
  }, [workspace.logo]);

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  const iconSize = size === 'filter' ? 9 : 10;
  const logoClass =
    size === 'filter' ? 'sidebar__filter-logo-wrap' : 'workspace-menu__logo-wrap';
  const iconClass = size === 'filter' ? 'sidebar__filter-icon' : 'workspace-menu__icon';
  const imageClass = size === 'filter' ? 'sidebar__filter-logo' : 'workspace-menu__logo';

  if (logoSrc && !logoFailed) {
    return (
      <span className={logoClass}>
        <img
          key={workspace.logo}
          src={logoSrc}
          alt=''
          className={imageClass}
          onError={handleLogoError}
        />
      </span>
    );
  }

  return (
    <span className={iconClass} style={{ backgroundColor: workspace.color }} aria-hidden>
      <ProjectIconMark icon={workspace.icon} size={iconSize} strokeWidth={2} />
    </span>
  );
}

export const WorkspaceMark = memo(WorkspaceMarkComponent);
