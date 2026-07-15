import { memo, type CSSProperties } from 'react';
import { History } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainTimelineEvent } from '@/components/brain/brainTypes';

interface BrainTimelineTabProps {
  timeline: BrainTimelineEvent[];
}

const EVENT_ACCENTS = [
  BRAIN_ACCENTS.purple,
  BRAIN_ACCENTS.blue,
  BRAIN_ACCENTS.green,
  BRAIN_ACCENTS.cyan,
  BRAIN_ACCENTS.amber,
  BRAIN_ACCENTS.red,
  BRAIN_ACCENTS.pink,
];

function BrainTimelineTabComponent({ timeline }: BrainTimelineTabProps) {
  if (timeline.length === 0) {
    return (
      <EmptyState
        icon={History}
        title='Linha do tempo vazia'
        message='Eventos cronológicos do conhecimento aparecerão aqui.'
        className='brain-empty'
      />
    );
  }

  return (
    <ol className='brain-timeline app-button--enter'>
      {timeline.map((event, index) => {
        const accent = EVENT_ACCENTS[index % EVENT_ACCENTS.length];

        return (
          <li
            key={event.id}
            className='brain-timeline__item'
            style={{ ['--card-accent' as string]: accent } as CSSProperties}
          >
            <div className='brain-timeline__rail' aria-hidden='true'>
              <span className='brain-timeline__dot' />
              {index < timeline.length - 1 ? <span className='brain-timeline__line' /> : null}
            </div>
            <div className='brain-timeline__content'>
              <span className='brain-timeline__date'>{event.dateLabel}</span>
              <strong className='brain-timeline__title'>{event.title}</strong>
              <p className='brain-timeline__text'>{event.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const BrainTimelineTab = memo(BrainTimelineTabComponent);
