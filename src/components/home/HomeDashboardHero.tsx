import { memo } from 'react';

interface HomeDashboardHeroProps {
  dateLabel: string;
  timeLabel: string;
}

function HomeDashboardHeroComponent({ dateLabel, timeLabel }: HomeDashboardHeroProps) {
  return (
    <header className='home-dashboard__hero app-button--enter'>
      <h1 className='home-dashboard__greeting'>Olá, Edson.</h1>
      <div className='home-dashboard__hero-clock'>
        <p className='home-dashboard__date'>{dateLabel}</p>
        <p className='home-dashboard__time'>{timeLabel}</p>
      </div>
    </header>
  );
}

export const HomeDashboardHero = memo(HomeDashboardHeroComponent);
