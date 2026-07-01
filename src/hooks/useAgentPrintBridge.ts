import { useEffect } from 'react';
import { ensureAgentPrintBridge } from '@/utils/agentPrintBridge';

export function useAgentPrintBridge(): void {
  useEffect(() => {
    ensureAgentPrintBridge();
  }, []);
}
