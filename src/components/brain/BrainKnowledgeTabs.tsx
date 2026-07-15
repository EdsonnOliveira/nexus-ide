import { memo, useCallback, type CSSProperties } from 'react';
import {
  BookOpen,
  Bot,
  CircleHelp,
  FileText,
  History,
  LayoutDashboard,
  MessageSquareText,
  Mic,
  Network,
  Scale,
  Sparkles,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { BRAIN_KNOWLEDGE_TABS } from '@/components/brain/brainConstants';
import { BRAIN_TAB_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainKnowledgeTabId } from '@/components/brain/brainTypes';

interface BrainKnowledgeTabsProps {
  activeTab: BrainKnowledgeTabId;
  onChange: (tabId: BrainKnowledgeTabId) => void;
}

const TAB_ICONS: Record<BrainKnowledgeTabId, LucideIcon> = {
  summary: LayoutDashboard,
  documents: FileText,
  meetings: Mic,
  decisions: Scale,
  prompts: MessageSquareText,
  agents: Bot,
  concepts: Network,
  timeline: History,
  people: Users,
  questions: CircleHelp,
  memory: Sparkles,
  map: Waypoints,
};

function BrainKnowledgeTabsComponent({ activeTab, onChange }: BrainKnowledgeTabsProps) {
  const handleSelect = useCallback(
    (tabId: BrainKnowledgeTabId) => {
      onChange(tabId);
    },
    [onChange],
  );

  return (
    <div className='brain-view__tabs' role='tablist' aria-label='Abas do conhecimento'>
      {BRAIN_KNOWLEDGE_TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const Icon = TAB_ICONS[tab.id];
        const accent = BRAIN_TAB_ACCENTS[tab.id] ?? '#94a3b8';

        return (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={isActive}
            className={`brain-view__tab app-button${isActive ? ' brain-view__tab--active app-button--enter' : ''}`}
            style={{ ['--tab-accent' as string]: accent } as CSSProperties}
            onClick={() => handleSelect(tab.id)}
          >
            <span className='brain-view__tab-icon' aria-hidden='true'>
              <Icon size={13} strokeWidth={2.1} />
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export const BrainKnowledgeTabs = memo(BrainKnowledgeTabsComponent);
