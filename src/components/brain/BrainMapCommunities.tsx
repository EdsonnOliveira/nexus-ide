import { memo, useCallback, useMemo } from 'react';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import type { BrainMapCommunity } from '@/components/brain/brainTypes';

interface BrainMapCommunitiesProps {
  communities: BrainMapCommunity[];
  enabledIds: Set<string>;
  onToggle: (communityId: string, enabled: boolean) => void;
  onToggleAll: (enabled: boolean) => void;
}

function BrainMapCommunitiesComponent({
  communities,
  enabledIds,
  onToggle,
  onToggleAll,
}: BrainMapCommunitiesProps) {
  const allEnabled = useMemo(
    () => communities.length > 0 && communities.every((item) => enabledIds.has(item.id)),
    [communities, enabledIds],
  );

  const handleToggleAll = useCallback(
    (checked: boolean) => {
      onToggleAll(checked);
    },
    [onToggleAll],
  );

  return (
    <aside className='brain-map__communities' aria-label='Comunidades'>
      <h3 className='brain-map__communities-title'>Comunidades</h3>

      <div className='brain-map__community-row brain-map__community-row--all'>
        <AppCheckbox
          checked={allEnabled}
          onChange={handleToggleAll}
          aria-label='Selecionar todas as comunidades'
        />
        <button
          type='button'
          className='brain-map__community-hit app-button'
          onClick={() => handleToggleAll(!allEnabled)}
        >
          <span className='brain-map__community-label'>Selecionar todas</span>
        </button>
      </div>

      <div className='brain-map__community-list'>
        {communities.map((community) => {
          const checked = enabledIds.has(community.id);

          return (
            <div key={community.id} className='brain-map__community-row'>
              <AppCheckbox
                checked={checked}
                onChange={(next) => onToggle(community.id, next)}
                aria-label={community.label}
              />
              <button
                type='button'
                className='brain-map__community-hit app-button'
                onClick={() => onToggle(community.id, !checked)}
              >
                <span
                  className='brain-map__community-dot'
                  style={{ backgroundColor: community.color }}
                  aria-hidden='true'
                />
                <span className='brain-map__community-label'>{community.label}</span>
                <span className='brain-map__community-count'>{community.count}</span>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export const BrainMapCommunities = memo(BrainMapCommunitiesComponent);
