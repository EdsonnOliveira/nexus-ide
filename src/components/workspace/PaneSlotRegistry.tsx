import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface PaneSlotRegistryValue {
  version: number;
  register: (paneId: string, node: HTMLDivElement) => void;
  unregister: (paneId: string, node: HTMLDivElement) => void;
  getSlot: (paneId: string) => HTMLDivElement | null;
}

const PaneSlotRegistryContext = createContext<PaneSlotRegistryValue | null>(null);

function PaneSlotRegistryProviderComponent({ children }: { children: ReactNode }) {
  const slotsRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [version, setVersion] = useState(0);

  const register = useCallback((paneId: string, node: HTMLDivElement) => {
    const current = slotsRef.current.get(paneId);

    if (current === node) {
      return;
    }

    slotsRef.current.set(paneId, node);
    setVersion((value) => value + 1);
  }, []);

  const unregister = useCallback((paneId: string, node: HTMLDivElement) => {
    if (slotsRef.current.get(paneId) !== node) {
      return;
    }

    slotsRef.current.delete(paneId);
    setVersion((value) => value + 1);
  }, []);

  const getSlot = useCallback((paneId: string) => slotsRef.current.get(paneId) ?? null, []);

  const value = useMemo(
    () => ({
      version,
      register,
      unregister,
      getSlot,
    }),
    [getSlot, register, unregister, version],
  );

  return (
    <PaneSlotRegistryContext.Provider value={value}>{children}</PaneSlotRegistryContext.Provider>
  );
}

export const PaneSlotRegistryProvider = memo(PaneSlotRegistryProviderComponent);

export function usePaneSlotRegistry(): PaneSlotRegistryValue {
  const context = useContext(PaneSlotRegistryContext);

  if (!context) {
    throw new Error('usePaneSlotRegistry must be used within PaneSlotRegistryProvider');
  }

  return context;
}
