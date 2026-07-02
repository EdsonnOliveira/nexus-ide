import { memo } from 'react';

interface HomeDashboardSkeletonBlockProps {
  className?: string;
}

function HomeDashboardSkeletonBlockComponent({ className = '' }: HomeDashboardSkeletonBlockProps) {
  return (
    <div
      className={`home-dashboard__skeleton-block${className ? ` ${className}` : ''}`}
      aria-hidden='true'
    />
  );
}

export const HomeDashboardSkeletonBlock = memo(HomeDashboardSkeletonBlockComponent);

interface HomeDashboardSkeletonRowsProps {
  count?: number;
  className?: string;
  rowClassName?: string;
}

function HomeDashboardSkeletonRowsComponent({
  count = 4,
  className = '',
  rowClassName = 'home-dashboard__skeleton-row',
}: HomeDashboardSkeletonRowsProps) {
  return (
    <div
      className={`home-dashboard__skeleton-list${className ? ` ${className}` : ''}`}
      aria-hidden='true'
    >
      {Array.from({ length: count }, (_, index) => (
        <HomeDashboardSkeletonBlock key={index} className={rowClassName} />
      ))}
    </div>
  );
}

export const HomeDashboardSkeletonRows = memo(HomeDashboardSkeletonRowsComponent);

function HomeDashboardHeroSkeletonComponent() {
  return (
    <header className='home-dashboard__hero home-dashboard__hero--skeleton' aria-hidden='true'>
      <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-hero-greeting' />
      <div className='home-dashboard__hero-clock'>
        <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-hero-date' />
        <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-hero-time' />
      </div>
    </header>
  );
}

export const HomeDashboardHeroSkeleton = memo(HomeDashboardHeroSkeletonComponent);

function HomeDashboardNotificationSkeletonComponent() {
  return <HomeDashboardSkeletonRows count={3} rowClassName='home-dashboard__skeleton-row home-dashboard__skeleton-row--notification' />;
}

export const HomeDashboardNotificationSkeleton = memo(HomeDashboardNotificationSkeletonComponent);

function HomeDashboardCalendarSkeletonComponent() {
  return <HomeDashboardSkeletonRows count={3} rowClassName='home-dashboard__skeleton-row home-dashboard__skeleton-row--calendar' />;
}

export const HomeDashboardCalendarSkeleton = memo(HomeDashboardCalendarSkeletonComponent);

function HomeDashboardMailSkeletonComponent() {
  return (
    <HomeDashboardSkeletonRows
      count={4}
      className='home-dashboard__skeleton-list--mail'
      rowClassName='home-dashboard__skeleton-row home-dashboard__skeleton-row--mail'
    />
  );
}

export const HomeDashboardMailSkeleton = memo(HomeDashboardMailSkeletonComponent);

function HomeDashboardSelectSkeletonComponent() {
  return <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-select' />;
}

export const HomeDashboardSelectSkeleton = memo(HomeDashboardSelectSkeletonComponent);

const METRIC_SKELETON_ACCENTS = ['#60a5fa', '#34d399', '#c084fc', '#fbbf24'];

function HomeDashboardMetricsSkeletonComponent() {
  return (
    <section className='home-dashboard__metrics' aria-hidden='true'>
      {Array.from({ length: 4 }, (_, index) => (
        <article
          key={index}
          className='home-dashboard__metric-card home-dashboard__metric-card--skeleton'
          style={{ ['--card-accent' as string]: METRIC_SKELETON_ACCENTS[index] }}
        >
          <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-metric-head' />
          <div className='home-dashboard__skeleton-metric-body'>
            <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-metric-value' />
            <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-metric-bar' />
            <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-metric-value home-dashboard__skeleton-metric-value--today' />
            <HomeDashboardSkeletonBlock className='home-dashboard__skeleton-metric-bar home-dashboard__skeleton-metric-bar--today' />
          </div>
        </article>
      ))}
    </section>
  );
}

export const HomeDashboardMetricsSkeleton = memo(HomeDashboardMetricsSkeletonComponent);

function HomeDashboardTaskListSkeletonComponent() {
  return (
    <div className='home-dashboard__task-list home-dashboard__task-list--skeleton' aria-hidden='true'>
      {Array.from({ length: 5 }, (_, index) => (
        <HomeDashboardSkeletonBlock key={index} className='home-dashboard__skeleton-task-row' />
      ))}
    </div>
  );
}

export const HomeDashboardTaskListSkeleton = memo(HomeDashboardTaskListSkeletonComponent);

function HomeDashboardDailySkeletonComponent() {
  return (
    <HomeDashboardSkeletonRows
      count={4}
      className='home-dashboard__daily-list home-dashboard__daily-list--skeleton'
      rowClassName='home-dashboard__skeleton-row home-dashboard__skeleton-row--daily'
    />
  );
}

export const HomeDashboardDailySkeleton = memo(HomeDashboardDailySkeletonComponent);
