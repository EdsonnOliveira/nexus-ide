import { memo } from 'react';
import { AgentProjectSkillPills } from '@/components/agent/AgentProjectSkillPills';
import { AgentResponseCopyPill } from '@/components/agent/AgentResponseCopyPill';

interface AgentResponseActionsProps {
  projectId: string;
  projectPath: string;
  paneId: string;
  content: string;
  showSkillPills?: boolean;
}

function AgentResponseActionsComponent({
  projectId,
  projectPath,
  paneId,
  content,
  showSkillPills = false,
}: AgentResponseActionsProps) {
  return (
    <div
      className={`agent-view__response-actions${showSkillPills ? '' : ' agent-view__response-actions--copy-only'}`}
    >
      {showSkillPills ? (
        <AgentProjectSkillPills
          projectId={projectId}
          projectPath={projectPath}
          paneId={paneId}
          responseContent={content}
        />
      ) : null}
      <AgentResponseCopyPill content={content} />
    </div>
  );
}

export const AgentResponseActions = memo(AgentResponseActionsComponent);
