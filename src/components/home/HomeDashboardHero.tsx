import { memo, type ReactNode } from 'react';
import { NexusLogo } from '@/components/overlay/NexusLogo';
import { useHomeDashboardClock } from '@/hooks/useHomeDashboardClock';

interface HomeDashboardHeroProps {
  compact?: boolean;
  askSlot: ReactNode;
  switchSlot?: ReactNode;
}

function HomeDashboardClockLabels() {
  const { dateLabel, timeLabel } = useHomeDashboardClock();

  return (
    <div className='home-dashboard__hero-clock'>
      <p className='home-dashboard__date'>{dateLabel}</p>
      <p className='home-dashboard__time'>{timeLabel}</p>
    </div>
  );
}

function HomeDashboardHeroComponent({
  compact = false,
  askSlot,
  switchSlot,
}: HomeDashboardHeroProps) {
  return (
    <header
      className={`home-dashboard__hero app-button--enter${
        compact ? ' home-dashboard__hero--compact' : ''
      }`}
    >
      <HomeDashboardClockLabels />
      <div className='home-dashboard__hero-brand'>
        <NexusLogo
          size={compact ? 28 : 56}
          className='nexus-brand-logo home-dashboard__hero-logo'
        />
        <div className='home-dashboard__hero-copy'>
          <h1 className='home-dashboard__greeting'>Olá, Edson.</h1>
          <p className='home-dashboard__hero-subtitle'>
            O mesmo agente de programação poderoso, agora no Nexus.
          </p>
        </div>
      </div>
      <div className='home-dashboard__hero-ask'>{askSlot}</div>
      {switchSlot ? <div className='home-dashboard__hero-switch'>{switchSlot}</div> : null}
    </header>
  );
}

export const HomeDashboardHero = memo(HomeDashboardHeroComponent);
