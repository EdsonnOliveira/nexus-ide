import { memo, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface BrainSectionCardProps {
  icon: LucideIcon;
  title: string;
  accent: string;
  children: ReactNode;
  className?: string;
  enterDelayMs?: number;
  headerMeta?: ReactNode;
}

function BrainSectionCardComponent({
  icon: Icon,
  title,
  accent,
  children,
  className = '',
  enterDelayMs = 0,
  headerMeta,
}: BrainSectionCardProps) {
  return (
    <section
      className={`brain-section app-button--enter${className ? ` ${className}` : ''}`}
      style={
        {
          animationDelay: `${enterDelayMs}ms`,
          ['--card-accent' as string]: accent,
        } as CSSProperties
      }
    >
      <header className='brain-section__header'>
        <span className='brain-section__icon' aria-hidden='true'>
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className='brain-section__heading'>
          <h3 className='brain-section__title'>{title}</h3>
          {headerMeta}
        </div>
      </header>
      <div className='brain-section__body'>{children}</div>
    </section>
  );
}

export const BrainSectionCard = memo(BrainSectionCardComponent);
