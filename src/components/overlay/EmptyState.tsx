import { memo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title?: string;
  message?: string;
  children?: ReactNode;
  className?: string;
  iconSize?: number;
  compact?: boolean;
}

function EmptyStateComponent({
  icon: Icon,
  title,
  message,
  children,
  className = '',
  iconSize = 22,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`empty-state${compact ? ' empty-state--compact' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        className={`empty-state__icon${compact ? ' empty-state__icon--compact' : ''}`}
        aria-hidden='true'
      >
        <Icon size={compact ? 16 : iconSize} strokeWidth={1.75} />
      </div>
      {title ? <span className='empty-state__title'>{title}</span> : null}
      {message ? <span className='empty-state__message'>{message}</span> : null}
      {children}
    </div>
  );
}

export const EmptyState = memo(EmptyStateComponent);
