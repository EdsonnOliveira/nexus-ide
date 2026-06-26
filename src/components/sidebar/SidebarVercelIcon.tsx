import { memo } from 'react';

interface SidebarVercelIconProps {
  size?: number;
}

function SidebarVercelIconComponent({ size = 14 }: SidebarVercelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='currentColor'
      aria-hidden='true'
    >
      <path d='M12 2L2 19.5h20L12 2z' />
    </svg>
  );
}

export const SidebarVercelIcon = memo(SidebarVercelIconComponent);
