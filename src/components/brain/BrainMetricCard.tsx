import { memo, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface BrainMetricCardProps {
  icon: LucideIcon;
  label: string;
  accent: string;
  children: ReactNode;
  className?: string;
  enterDelayMs?: number;
}

function BrainMetricCardComponent({
  icon: Icon,
  label,
  accent,
  children,
  className = '',
  enterDelayMs = 0,
}: BrainMetricCardProps) {
  return (
    <section
      className={`brain-metric app-button--enter${className ? ` ${className}` : ''}`}
      style={
        {
          animationDelay: `${enterDelayMs}ms`,
          ['--card-accent' as string]: accent,
        } as CSSProperties
      }
    >
      <header className='brain-metric__head'>
        <span className='brain-metric__icon' aria-hidden='true'>
          <Icon size={16} strokeWidth={2} />
        </span>
        <span className='brain-metric__label'>{label}</span>
      </header>
      <div className='brain-metric__body'>{children}</div>
    </section>
  );
}

export const BrainMetricCard = memo(BrainMetricCardComponent);
