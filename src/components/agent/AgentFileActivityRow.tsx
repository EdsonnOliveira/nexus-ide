import { memo } from 'react';
import type { AgentActivity } from '@/types';

interface AgentFileActivityRowProps {
  activity: AgentActivity;
}

function AgentFileActivityRowComponent({ activity }: AgentFileActivityRowProps) {
  const fileName = activity.filePath?.split(/[/\\]/).pop() ?? activity.filePath ?? '';
  const verb = activity.kind === 'file_read' ? 'Read' : 'Edited';

  return (
    <div className='agent-view__file-row'>
      <span className='agent-view__file-verb'>{verb}</span>
      <span className='agent-view__file-name'>{fileName}</span>
      {activity.kind === 'file_edit' ? (
        <span className='agent-view__file-diff'>
          {activity.additions !== undefined ? (
            <span className='agent-view__diff agent-view__diff--add'>+{activity.additions}</span>
          ) : null}
          {activity.deletions !== undefined ? (
            <span className='agent-view__diff agent-view__diff--del'>-{activity.deletions}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export const AgentFileActivityRow = memo(AgentFileActivityRowComponent);
