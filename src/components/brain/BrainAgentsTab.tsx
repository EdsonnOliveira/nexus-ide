import { memo } from 'react';
import { Bot, CheckCircle2, Clock3, Coins, Files, Cpu } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BrainMetricCard } from '@/components/brain/BrainMetricCard';
import { BrainSectionCard } from '@/components/brain/BrainSectionCard';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainAgentRun } from '@/components/brain/brainTypes';

interface BrainAgentsTabProps {
  agents: BrainAgentRun[];
  onAdd?: () => void;
}

function BrainAgentsTabComponent({ agents, onAdd }: BrainAgentsTabProps) {
  if (agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title='Nenhuma execução'
        message='Execuções de agentes e resultados aparecerão aqui.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar agente
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-cards-grid'>
      {agents.map((agent, index) => (
        <BrainSectionCard
          key={agent.id}
          icon={Bot}
          title={agent.name}
          accent={BRAIN_ACCENTS.cyan}
          enterDelayMs={40 + index * 40}
          headerMeta={
            <span
              className='brain-status-pill'
              style={{ ['--chip-accent' as string]: BRAIN_ACCENTS.green }}
            >
              <CheckCircle2 size={11} strokeWidth={2} aria-hidden='true' />
              {agent.result}
            </span>
          }
        >
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Missão</span>
            <p className='brain-detail__text'>{agent.mission}</p>
          </section>
          <div className='brain-summary__metrics brain-summary__metrics--compact'>
            <BrainMetricCard icon={Files} label='Arquivos' accent={BRAIN_ACCENTS.blue} enterDelayMs={0}>
              <strong className='brain-metric__value'>{agent.fileCount}</strong>
            </BrainMetricCard>
            <BrainMetricCard icon={Clock3} label='Tempo' accent={BRAIN_ACCENTS.amber} enterDelayMs={0}>
              <strong className='brain-metric__value'>{agent.durationLabel}</strong>
            </BrainMetricCard>
            <BrainMetricCard icon={Coins} label='Custo' accent={BRAIN_ACCENTS.green} enterDelayMs={0}>
              <strong className='brain-metric__value'>{agent.costLabel}</strong>
            </BrainMetricCard>
            <BrainMetricCard icon={Cpu} label='Modelo' accent={BRAIN_ACCENTS.purple} enterDelayMs={0}>
              <strong className='brain-metric__value brain-metric__value--sm'>{agent.model}</strong>
            </BrainMetricCard>
          </div>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Resumo</span>
            <p className='brain-detail__text'>{agent.summary}</p>
          </section>
        </BrainSectionCard>
      ))}
    </div>
  );
}

export const BrainAgentsTab = memo(BrainAgentsTabComponent);
