import { memo } from 'react';
import nexusLogo from '@/assets/nexus-logo.png';

interface NexusLogoProps {
  size?: number;
  className?: string;
  alt?: string;
}

function NexusLogoComponent({ size = 24, className, alt = 'Nexus IDE' }: NexusLogoProps) {
  return (
    <img
      src={nexusLogo}
      alt={alt}
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}

export const NexusLogo = memo(NexusLogoComponent);
