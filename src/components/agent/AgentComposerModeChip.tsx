import { memo, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import iconModeAsk from '@/assets/icon-mode-ask.svg';
import iconModeAgent from '@/assets/icon-mode-agent.svg';
import iconModeDebug from '@/assets/icon-mode-debug.svg';
import iconModeMultitask from '@/assets/icon-mode-multitask.svg';
import iconModePlan from '@/assets/icon-mode-plan.svg';
import type { AgentModeBadgeIcon, AgentModeOption, AutomationAgentMode } from '@/constants/agentModes';

const MODE_ICON_SRC: Record<AgentModeBadgeIcon, string> = {
  'mode-agent': iconModeAgent,
  'mode-plan': iconModePlan,
  'mode-ask': iconModeAsk,
  'mode-debug': iconModeDebug,
  'mode-multitask': iconModeMultitask,
};

interface AgentComposerModeChipProps {
  mode: AutomationAgentMode;
  option: AgentModeOption;
  onClear: () => void;
}

function AgentComposerModeChipComponent({ mode, option, onClear }: AgentComposerModeChipProps) {
  const iconSrc = MODE_ICON_SRC[option.badgeIcon];

  return (
    <div
      className={`agent-view__composer-mode-chip agent-view__composer-mode-chip--${mode} app-button--enter`}
      style={{ '--mode-chip-accent': option.badgeColor } as CSSProperties}
    >
      <span
        className='agent-view__composer-mode-chip-icon'
        style={{
          backgroundColor: option.badgeColor,
          WebkitMaskImage: `url("${iconSrc}")`,
          maskImage: `url("${iconSrc}")`,
        }}
        aria-hidden='true'
      />
      <span className='agent-view__composer-mode-chip-label'>{option.label}</span>
      <button
        type='button'
        className='agent-view__composer-mode-chip-clear app-button'
        aria-label={`Remover modo ${option.label}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClear}
      >
        <X size={12} strokeWidth={2.25} aria-hidden='true' />
      </button>
    </div>
  );
}

export const AgentComposerModeChip = memo(AgentComposerModeChipComponent);
