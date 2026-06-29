import { memo } from 'react';
import type { AgentActivity } from '@/types';

interface AgentLiveStatusProps {
  label: string;
}

function AgentLiveStatusComponent({ label }: AgentLiveStatusProps) {
  return (
    <div className='agent-view__live-status' role='status' aria-live='polite'>
      <span className='agent-view__live-status-spinner' aria-hidden='true' />
      <span className='agent-view__live-status-label'>{label}</span>
    </div>
  );
}

export const AgentLiveStatus = memo(AgentLiveStatusComponent);

export function AgentLiveStatusFromActivity({ activity }: { activity: AgentActivity }) {
  return <AgentLiveStatus label={activity.label} />;
}
