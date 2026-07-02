import { Bot, GitCommitHorizontal, MessageSquareText, Rows3, type LucideIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { HomeDashboardMetricsSkeleton } from '@/components/home/HomeDashboardSkeletons';
import type { HomeDashboardDayStats } from '@/types';

interface HomeDashboardActivityStatsProps {
  today: HomeDashboardDayStats;
  yesterday: HomeDashboardDayStats;
  loading?: boolean;
}

interface MetricDefinition {
  id: keyof HomeDashboardDayStats;
  label: string;
  icon: LucideIcon;
  accent: string;
}

const METRICS: MetricDefinition[] = [
  {
    id: 'commits',
    label: 'Commits realizados',
    icon: GitCommitHorizontal,
    accent: '#60a5fa',
  },
  {
    id: 'linesChanged',
    label: 'Linhas alteradas',
    icon: Rows3,
    accent: '#34d399',
  },
  {
    id: 'agentExecutions',
    label: 'Agents executados',
    icon: Bot,
    accent: '#c084fc',
  },
  {
    id: 'prompts',
    label: 'Prompts realizados',
    icon: MessageSquareText,
    accent: '#fbbf24',
  },
];

function formatMetricValue(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1000)}k`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }

  return String(value);
}

interface MetricCardProps {
  metric: MetricDefinition;
  today: number;
  yesterday: number;
  enterDelayMs: number;
}

function MetricCardComponent({ metric, today, yesterday, enterDelayMs }: MetricCardProps) {
  const Icon = metric.icon;
  const maxValue = Math.max(today, yesterday, 1);
  const todayWidth = Math.max(8, Math.round((today / maxValue) * 100));
  const yesterdayWidth = Math.max(8, Math.round((yesterday / maxValue) * 100));
  const trend =
    today === yesterday ? 'flat' : today > yesterday ? 'up' : 'down';

  return (
    <article
      className='home-dashboard__metric-card app-button--enter'
      style={{
        animationDelay: `${enterDelayMs}ms`,
        ['--card-accent' as string]: metric.accent,
      }}
    >
      <header className='home-dashboard__metric-head'>
        <span className='home-dashboard__metric-icon' aria-hidden='true'>
          <Icon size={16} strokeWidth={2.1} />
        </span>
        <h3 className='home-dashboard__metric-label'>{metric.label}</h3>
      </header>

      <div className='home-dashboard__metric-compare'>
        <div className='home-dashboard__metric-col'>
          <span className='home-dashboard__metric-col-label'>Ontem</span>
          <span className='home-dashboard__metric-col-value'>{formatMetricValue(yesterday)}</span>
          <span className='home-dashboard__metric-bar-track' aria-hidden='true'>
            <span
              className='home-dashboard__metric-bar home-dashboard__metric-bar--yesterday'
              style={{ width: `${yesterdayWidth}%` }}
            />
          </span>
        </div>

        <span
          className={`home-dashboard__metric-trend home-dashboard__metric-trend--${trend}`}
          aria-hidden='true'
        >
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '•'}
        </span>

        <div className='home-dashboard__metric-col home-dashboard__metric-col--today'>
          <span className='home-dashboard__metric-col-label'>Hoje</span>
          <span className='home-dashboard__metric-col-value'>{formatMetricValue(today)}</span>
          <span className='home-dashboard__metric-bar-track' aria-hidden='true'>
            <span
              className='home-dashboard__metric-bar home-dashboard__metric-bar--today'
              style={{ width: `${todayWidth}%` }}
            />
          </span>
        </div>
      </div>
    </article>
  );
}

const MetricCard = memo(MetricCardComponent);

function HomeDashboardActivityStatsComponent({
  today,
  yesterday,
  loading = false,
}: HomeDashboardActivityStatsProps) {
  const cards = useMemo(
    () =>
      METRICS.map((metric, index) => ({
        metric,
        today: today[metric.id],
        yesterday: yesterday[metric.id],
        enterDelayMs: 140 + index * 45,
      })),
    [today, yesterday],
  );

  if (loading) {
    return <HomeDashboardMetricsSkeleton />;
  }

  return (
    <section className='home-dashboard__metrics' aria-label='Indicadores de atividade'>
      {cards.map(({ metric, today: todayValue, yesterday: yesterdayValue, enterDelayMs }) => (
        <MetricCard
          key={metric.id}
          metric={metric}
          today={todayValue}
          yesterday={yesterdayValue}
          enterDelayMs={enterDelayMs}
        />
      ))}
    </section>
  );
}

export const HomeDashboardActivityStats = memo(HomeDashboardActivityStatsComponent);
