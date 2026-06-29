import { memo } from 'react';
import type { TerminalCommandHint } from '@/types';
import {
  resolveHintBadgeColor,
  resolveHintBadgeIconSrc,
} from '@/utils/agentHintBadges';

interface AgentHintLeadingProps {
  hint: TerminalCommandHint;
}

function AgentHintLeadingComponent({ hint }: AgentHintLeadingProps) {
  const iconSrc = resolveHintBadgeIconSrc(hint);
  const badgeColor = resolveHintBadgeColor(hint);
  const isMode =
    hint.hintKind === 'mode' ||
    (hint.badgeIcon?.startsWith('mode-') && hint.badgeIcon !== 'mode-agent');

  if (iconSrc && badgeColor && isMode) {
    return (
      <span
        className='agent-view__composer-mode-icon'
        style={{
          backgroundColor: badgeColor,
          WebkitMaskImage: `url("${iconSrc}")`,
          maskImage: `url("${iconSrc}")`,
        }}
        aria-hidden='true'
      />
    );
  }

  if (iconSrc && badgeColor) {
    return (
      <span className='agent-view__composer-hint-badge' style={{ backgroundColor: badgeColor }}>
        <img
          src={iconSrc}
          alt=''
          className='agent-view__composer-hint-badge-icon'
          draggable={false}
        />
      </span>
    );
  }

  if (hint.badge && badgeColor) {
    return (
      <span
        className='agent-view__composer-hint-badge agent-view__composer-hint-badge--text'
        style={{ backgroundColor: badgeColor }}
      >
        {hint.badge}
      </span>
    );
  }

  return null;
}

export const AgentHintLeading = memo(AgentHintLeadingComponent);
