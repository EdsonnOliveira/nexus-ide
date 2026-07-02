import { memo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface HomeDashboardSectionProps {
  icon: LucideIcon;
  title: string;
  accent: string;
  children: ReactNode;
  className?: string;
  enterDelayMs?: number;
  headerAction?: ReactNode;
  headerMeta?: ReactNode;
}

function HomeDashboardSectionComponent({
  icon: Icon,
  title,
  accent,
  children,
  className = '',
  enterDelayMs = 0,
  headerAction,
  headerMeta,
}: HomeDashboardSectionProps) {
  return (
    <section
      className={`home-dashboard__section app-button--enter${className ? ` ${className}` : ''}`}
      style={{
        animationDelay: `${enterDelayMs}ms`,
        ['--card-accent' as string]: accent,
      }}
    >
      <header className='home-dashboard__section-header'>
        <span className='home-dashboard__section-icon' aria-hidden='true'>
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className='home-dashboard__section-heading'>
          <h2 className='home-dashboard__section-title'>{title}</h2>
          {headerMeta}
        </div>
        {headerAction ? (
          <div className='home-dashboard__section-action'>{headerAction}</div>
        ) : null}
      </header>
      <div className='home-dashboard__section-body'>{children}</div>
    </section>
  );
}

export const HomeDashboardSection = memo(HomeDashboardSectionComponent);
