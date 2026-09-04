import { Sparkles, X } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useMissionStore } from '@/stores/useMissionStore';
import { dismissMissionCompanionEvent } from '@/utils/missionCompanion';

interface MissionCompanionOverlayProps {
  missionId: string;
}

function MissionCompanionOverlayComponent({
  missionId,
}: MissionCompanionOverlayProps) {
  const mission = useMissionStore((state) =>
    state.missions.find((entry) => entry.id === missionId),
  );

  const events = useMemo(
    () => (mission?.companionEvents ?? []).filter((event) => !event.dismissedAt).slice(0, 3),
    [mission?.companionEvents],
  );

  if (!mission || mission.companionEnabled === false || events.length === 0) {
    return null;
  }

  return (
    <div className='mission-companion-stack'>
      {events.map((event) => (
        <div key={event.id} className='mission-companion-card overlay-popup--in' role='status'>
          <div className='mission-companion-card__header'>
            <Sparkles size={14} strokeWidth={2.25} aria-hidden='true' />
            <strong>{event.title}</strong>
            <button
              type='button'
              className='app-button mission-companion-card__close'
              aria-label='Dispensar'
              onClick={() => dismissMissionCompanionEvent(missionId, event.id)}
            >
              <X size={14} />
            </button>
          </div>
          <p>{event.summary}</p>
          {event.nextStep ? <p className='mission-companion-card__next'>{event.nextStep}</p> : null}
        </div>
      ))}
    </div>
  );
}

export const MissionCompanionOverlay = memo(MissionCompanionOverlayComponent);
