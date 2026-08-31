import { useEffect } from 'react';
import { useNexusReady } from '@/hooks/useNexusReady';
import { useMissionStore } from '@/stores/useMissionStore';

export function useMissionHydration(): void {
  const nexusReady = useNexusReady();
  const hydrate = useMissionStore((state) => state.hydrate);
  const applyMission = useMissionStore((state) => state.applyMission);
  const applyInbox = useMissionStore((state) => state.applyInbox);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }
    void hydrate();
  }, [hydrate, nexusReady]);

  useEffect(() => {
    if (!nexusReady || !window.nexus?.missions) {
      return;
    }

    const offUpdated = window.nexus.missions.onUpdated((mission) => {
      applyMission(mission);
    });
    const offInbox = window.nexus.missions.onInbox((items) => {
      applyInbox(items);
    });

    return () => {
      offUpdated();
      offInbox();
    };
  }, [applyInbox, applyMission, nexusReady]);
}
