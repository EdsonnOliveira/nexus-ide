import { memo, useCallback, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { NexusLogo } from '@/components/overlay/NexusLogo';
import { useHomeDashboardClock } from '@/hooks/useHomeDashboardClock';

interface HomeDashboardHeroProps {
  compact?: boolean;
  dense?: boolean;
  hideBrand?: boolean;
  showDensityToggle?: boolean;
  onDensityToggle?: () => void;
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
  dense = false,
  hideBrand = false,
  showDensityToggle = false,
  onDensityToggle,
  askSlot,
  switchSlot,
}: HomeDashboardHeroProps) {
  const [densityMotion, setDensityMotion] = useState(false);

  const handleDensityToggle = useCallback(() => {
    setDensityMotion(true);
    onDensityToggle?.();
  }, [onDensityToggle]);

  return (
    <header
      className={`home-dashboard__hero app-button--enter${
        compact ? ' home-dashboard__hero--compact' : ''
      }${hideBrand ? ' home-dashboard__hero--no-brand' : ''}`}
    >
      {showDensityToggle ? (
        <button
          type='button'
          className={`home-dashboard__hero-density app-button app-button--enter${
            dense ? ' home-dashboard__hero-density--active' : ''
          }${densityMotion ? ' home-dashboard__hero-density--motion' : ''}`}
          aria-label={dense ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-pressed={dense}
          title={dense ? 'Sair da tela cheia' : 'Tela cheia'}
          onClick={handleDensityToggle}
        >
          <span className='home-dashboard__hero-density-icons' aria-hidden='true'>
            <Maximize2
              size={18}
              strokeWidth={2.1}
              className='home-dashboard__hero-density-icon home-dashboard__hero-density-icon--max'
            />
            <Minimize2
              size={18}
              strokeWidth={2.1}
              className='home-dashboard__hero-density-icon home-dashboard__hero-density-icon--min'
            />
          </span>
        </button>
      ) : null}
      <HomeDashboardClockLabels />
      <div className='home-dashboard__hero-brand' aria-hidden={hideBrand}>
        <NexusLogo
          size={compact ? 28 : dense ? 36 : 56}
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
