import { memo } from 'react';
import { resolveProjectPresetIcon } from '@/constants/projectPresetIcons';

interface ProjectIconMarkProps {
  icon: string;
  size?: number;
  strokeWidth?: number;
}

function ProjectIconMarkComponent({ icon, size = 13, strokeWidth = 2.25 }: ProjectIconMarkProps) {
  const PresetIcon = resolveProjectPresetIcon(icon);

  if (PresetIcon) {
    return <PresetIcon size={size} strokeWidth={strokeWidth} aria-hidden />;
  }

  return <>{icon}</>;
}

export const ProjectIconMark = memo(ProjectIconMarkComponent);
