import { memo } from 'react';
import {
  Boxes,
  Clock3,
  FolderKanban,
  ListChecks,
  Sparkles,
  Target,
  Users,
  Workflow,
} from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BrainMetricCard } from '@/components/brain/BrainMetricCard';
import { BrainSectionCard } from '@/components/brain/BrainSectionCard';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainSummary } from '@/components/brain/brainTypes';

interface BrainSummaryTabProps {
  summary: BrainSummary;
}

const STACK_ACCENTS = [
  BRAIN_ACCENTS.green,
  BRAIN_ACCENTS.red,
  BRAIN_ACCENTS.amber,
  BRAIN_ACCENTS.green,
  BRAIN_ACCENTS.cyan,
  BRAIN_ACCENTS.blue,
];

const TEAM_ACCENTS = [BRAIN_ACCENTS.pink, BRAIN_ACCENTS.blue];

const RELATED_ACCENTS = [BRAIN_ACCENTS.indigo, BRAIN_ACCENTS.cyan, BRAIN_ACCENTS.amber];

function BrainSummaryTabComponent({ summary }: BrainSummaryTabProps) {
  return (
    <div className='brain-summary'>
      <div className='brain-summary__metrics'>
        <BrainMetricCard
          icon={FolderKanban}
          label='Projeto'
          accent={BRAIN_ACCENTS.purple}
          enterDelayMs={40}
        >
          <strong className='brain-metric__value'>{summary.projectName}</strong>
        </BrainMetricCard>
        <BrainMetricCard
          icon={Target}
          label='Objetivo'
          accent={BRAIN_ACCENTS.blue}
          enterDelayMs={80}
        >
          <p className='brain-metric__text'>{summary.objective}</p>
        </BrainMetricCard>
        <BrainMetricCard
          icon={ListChecks}
          label='Status'
          accent={BRAIN_ACCENTS.green}
          enterDelayMs={120}
        >
          <strong className='brain-metric__value'>{summary.statusLabel}</strong>
          <div className='brain-metric__bar' aria-hidden='true'>
            <span style={{ width: `${summary.statusProgress}%` }} />
          </div>
        </BrainMetricCard>
        <BrainMetricCard
          icon={Clock3}
          label='Última atualização'
          accent={BRAIN_ACCENTS.amber}
          enterDelayMs={160}
        >
          <strong className='brain-metric__value'>{summary.lastUpdatedLabel}</strong>
        </BrainMetricCard>
      </div>

      <div className='brain-summary__sections'>
        <BrainSectionCard
          icon={Sparkles}
          title='Resumo'
          accent={BRAIN_ACCENTS.purple}
          enterDelayMs={200}
          className='brain-summary__resume'
        >
          <p className='brain-section__text'>{summary.summary}</p>
        </BrainSectionCard>

        <BrainSectionCard
          icon={ListChecks}
          title='Próximas prioridades'
          accent={BRAIN_ACCENTS.amber}
          enterDelayMs={240}
          className='brain-summary__priorities'
        >
          {summary.nextPriorities.length > 0 ? (
            <ul className='brain-priority-list'>
              {summary.nextPriorities.map((item, index) => (
                <li key={item} className='brain-priority-list__item'>
                  <span
                    className='brain-priority-list__index'
                    style={{
                      ['--card-accent' as string]: STACK_ACCENTS[index % STACK_ACCENTS.length],
                    }}
                  >
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={ListChecks}
              message='Nenhuma prioridade em aberto'
              compact
              className='brain-section-empty'
            />
          )}
        </BrainSectionCard>
      </div>

      <div className='brain-summary__meta-grid'>
        <BrainSectionCard icon={Boxes} title='Stack' accent={BRAIN_ACCENTS.cyan} enterDelayMs={280}>
          {summary.stack.length > 0 ? (
            <div className='brain-chip-row'>
              {summary.stack.map((item, index) => (
                <span
                  key={item}
                  className='brain-chip brain-chip--accented'
                  style={{
                    ['--chip-accent' as string]: STACK_ACCENTS[index % STACK_ACCENTS.length],
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Boxes}
              message='Stack ainda não detectada'
              compact
              className='brain-section-empty'
            />
          )}
        </BrainSectionCard>

        <BrainSectionCard icon={Users} title='Equipe' accent={BRAIN_ACCENTS.pink} enterDelayMs={320}>
          {summary.team.length > 0 ? (
            <div className='brain-chip-row'>
              {summary.team.map((item, index) => (
                <span
                  key={item}
                  className='brain-chip brain-chip--accented'
                  style={{
                    ['--chip-accent' as string]: TEAM_ACCENTS[index % TEAM_ACCENTS.length],
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Users}
              message='Nenhuma pessoa vinculada'
              compact
              className='brain-section-empty'
            />
          )}
        </BrainSectionCard>

        <BrainSectionCard
          icon={Workflow}
          title='Projetos relacionados'
          accent={BRAIN_ACCENTS.indigo}
          enterDelayMs={360}
          className='brain-summary__related'
        >
          {summary.relatedProjects.length > 0 ? (
            <div className='brain-chip-row'>
              {summary.relatedProjects.map((item, index) => (
                <span
                  key={item}
                  className='brain-chip brain-chip--accented'
                  style={{
                    ['--chip-accent' as string]: RELATED_ACCENTS[index % RELATED_ACCENTS.length],
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Workflow}
              message='Nenhum projeto relacionado'
              compact
              className='brain-section-empty'
            />
          )}
        </BrainSectionCard>
      </div>
    </div>
  );
}

export const BrainSummaryTab = memo(BrainSummaryTabComponent);
