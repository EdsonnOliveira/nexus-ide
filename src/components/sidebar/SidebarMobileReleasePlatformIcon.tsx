import { memo } from 'react';
import logoAndroid from '@/assets/logo-android.svg';
import logoApple from '@/assets/logo-apple.svg';
import type { MobileReleaseKind } from '@/types';

interface SidebarMobileReleasePlatformIconProps {
  kind: MobileReleaseKind;
  size?: number;
  className?: string;
}

function SidebarMobileReleasePlatformIconComponent({
  kind,
  size = 14,
  className = '',
}: SidebarMobileReleasePlatformIconProps) {
  const isIos = kind === 'ios-testflight';
  const platformClassName = isIos
    ? 'sidebar-mobile-release-platform-icon--ios'
    : 'sidebar-mobile-release-platform-icon--android';
  const src = isIos ? logoApple : logoAndroid;
  const label = isIos ? 'Apple' : 'Android';

  return (
    <img
      src={src}
      alt=''
      aria-label={label}
      width={size}
      height={size}
      className={`sidebar-mobile-release-platform-icon ${platformClassName}${className ? ` ${className}` : ''}`}
      draggable={false}
    />
  );
}

export const SidebarMobileReleasePlatformIcon = memo(SidebarMobileReleasePlatformIconComponent);
