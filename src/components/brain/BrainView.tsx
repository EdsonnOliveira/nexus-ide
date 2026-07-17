import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import {
  Bot,
  Brain,
  CircleHelp,
  FileText,
  MessageSquareText,
  Mic,
  Network,
  Scale,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { BrainAddButton } from '@/components/brain/BrainAddButton';
import { BrainAddModal } from '@/components/brain/BrainAddModal';
import { BrainAgentsTab } from '@/components/brain/BrainAgentsTab';
import { BrainConceptsTab } from '@/components/brain/BrainConceptsTab';
import { BrainDecisionsTab } from '@/components/brain/BrainDecisionsTab';
import { BrainDocumentsTab } from '@/components/brain/BrainDocumentsTab';
import { BrainKnowledgeTabs } from '@/components/brain/BrainKnowledgeTabs';
import { BrainLinkTranscriptionsModal } from '@/components/brain/BrainLinkTranscriptionsModal';
import { BrainMapTab } from '@/components/brain/BrainMapTab';
import { BrainMeetingsTab } from '@/components/brain/BrainMeetingsTab';
import { BrainMemoryTab } from '@/components/brain/BrainMemoryTab';
import { BrainPeopleTab } from '@/components/brain/BrainPeopleTab';
import { BrainPromptsTab } from '@/components/brain/BrainPromptsTab';
import { BrainQuestionsTab } from '@/components/brain/BrainQuestionsTab';
import { BrainSearchBar } from '@/components/brain/BrainSearchBar';
import { BrainSummaryTab } from '@/components/brain/BrainSummaryTab';
import { BrainTimelineTab } from '@/components/brain/BrainTimelineTab';
import { BRAIN_ACCENTS, BRAIN_KIND_ACCENTS, BRAIN_TAB_ACCENTS } from '@/components/brain/brainAccents';
import { groupSearchHits, searchBrainDataset } from '@/components/brain/brainSearch';
import type { BrainKnowledgeTabId, BrainSearchHit } from '@/components/brain/brainTypes';
import { useBrainDataset } from '@/hooks/useBrainDataset';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  isBrainManualEditableTab,
  addBrainManualDocumentsFromPicker,
  type BrainManualEditableTabId,
} from '@/utils/brainManualStore';

interface BrainSearchResultsProps {
  hits: BrainSearchHit[];
  onSelectHit: (hit: BrainSearchHit) => void;
}

const HIT_ICONS: Record<BrainSearchHit['kind'], LucideIcon> = {
  document: FileText,
  meeting: Mic,
  decision: Scale,
  prompt: MessageSquareText,
  agent: Bot,
  concept: Network,
  file: FileText,
  person: Users,
  question: CircleHelp,
  memory: Sparkles,
};

function BrainSearchResultsComponent({ hits, onSelectHit }: BrainSearchResultsProps) {
  const groups = useMemo(() => groupSearchHits(hits), [hits]);

  if (hits.length === 0) {
    return (
      <div className='brain-search-results brain-search-results--empty'>
        <p className='brain-detail__text'>Nenhum resultado para esta busca.</p>
      </div>
    );
  }

  return (
    <div className='brain-search-results app-button--enter'>
      <div className='brain-chip-row'>
        {groups.map((group, index) => (
          <span
            key={group.label}
            className='brain-chip brain-chip--accented'
            style={
              {
                ['--chip-accent' as string]:
                  [
                    BRAIN_ACCENTS.blue,
                    BRAIN_ACCENTS.green,
                    BRAIN_ACCENTS.amber,
                    BRAIN_ACCENTS.pink,
                    BRAIN_ACCENTS.cyan,
                    BRAIN_ACCENTS.purple,
                  ][index % 6],
              } as CSSProperties
            }
          >
            {group.count} {group.label}
          </span>
        ))}
      </div>
      <div className='brain-search-results__list'>
        {hits.map((hit) => {
          const Icon = HIT_ICONS[hit.kind];
          const accent = BRAIN_KIND_ACCENTS[hit.kind] ?? BRAIN_ACCENTS.slate;

          return (
            <button
              key={`${hit.kind}-${hit.id}`}
              type='button'
              className='brain-list-item app-button app-button--enter'
              style={{ ['--item-accent' as string]: accent } as CSSProperties}
              onClick={() => onSelectHit(hit)}
            >
              <span className='brain-list-item__row'>
                <span className='brain-list-item__icon' aria-hidden='true'>
                  <Icon size={15} strokeWidth={2} />
                </span>
                <span className='brain-list-item__main'>
                  <span className='brain-list-item__title'>{hit.title}</span>
                  <span className='brain-list-item__meta'>{hit.kind}</span>
                </span>
              </span>
              <span className='brain-list-item__summary'>{hit.subtitle}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const BrainSearchResults = memo(BrainSearchResultsComponent);

function BrainViewComponent() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const project = useMemo(
    () => projects.find((item) => item.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const { dataset, loading, reload } = useBrainDataset(project);

  const [activeTab, setActiveTab] = useState<BrainKnowledgeTabId>('summary');
  const [searchQuery, setSearchQuery] = useState('');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [linkTranscriptionsOpen, setLinkTranscriptionsOpen] = useState(false);

  const searchHits = useMemo(() => searchBrainDataset(searchQuery, dataset), [dataset, searchQuery]);
  const hasSearch = searchQuery.trim().length > 0;
  const canAdd = isBrainManualEditableTab(activeTab);
  const addTabId =
    canAdd && activeTab !== 'documents' && activeTab !== 'meetings'
      ? (activeTab as Exclude<BrainManualEditableTabId, 'documents' | 'meetings'>)
      : null;

  const handleTabChange = useCallback((tabId: BrainKnowledgeTabId) => {
    setActiveTab(tabId);
    setSearchQuery('');
    setAddModalOpen(false);
    setLinkTranscriptionsOpen(false);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const handleSelectHit = useCallback((hit: BrainSearchHit) => {
    setActiveTab(hit.tabId);
    setSearchQuery('');
  }, []);

  const handleOpenAdd = useCallback(() => {
    if (!canAdd || !project) {
      return;
    }

    if (activeTab === 'documents') {
      void (async () => {
        const result = await addBrainManualDocumentsFromPicker(project.path);
        if (result.ok && !result.cancelled) {
          reload();
        }
      })();
      return;
    }

    if (activeTab === 'meetings') {
      setLinkTranscriptionsOpen(true);
      return;
    }

    setAddModalOpen(true);
  }, [activeTab, canAdd, project, reload]);

  const handleCloseAdd = useCallback(() => {
    setAddModalOpen(false);
  }, []);

  const handleCloseLinkTranscriptions = useCallback(() => {
    setLinkTranscriptionsOpen(false);
  }, []);

  const handleSaved = useCallback(() => {
    setAddModalOpen(false);
    setLinkTranscriptionsOpen(false);
    reload();
  }, [reload]);

  return (
    <div className='brain-view'>
      <header className='brain-view__header'>
        <div className='brain-view__title-row'>
          <span
            className='brain-view__icon'
            style={{ ['--card-accent' as string]: BRAIN_TAB_ACCENTS.summary } as CSSProperties}
            aria-hidden='true'
          >
            <Brain size={18} strokeWidth={2} />
          </span>
          <div className='brain-view__title-copy'>
            <h2 className='brain-view__title'>Cérebro do Projeto</h2>
            <p className='brain-view__subtitle'>
              {loading
                ? 'Carregando conhecimento real do projeto…'
                : 'Base de conhecimento viva do projeto'}
            </p>
          </div>
        </div>
        <BrainSearchBar value={searchQuery} onChange={handleSearchChange} />
      </header>

      <div className='brain-view__tabs-row'>
        <BrainKnowledgeTabs activeTab={activeTab} onChange={handleTabChange} />
        {canAdd ? (
          <BrainAddButton onClick={handleOpenAdd} disabled={!project} />
        ) : null}
      </div>

      <div className='brain-view__body'>
        {hasSearch ? (
          <BrainSearchResults hits={searchHits} onSelectHit={handleSelectHit} />
        ) : null}

        {!hasSearch && activeTab === 'summary' ? (
          <BrainSummaryTab summary={dataset.summary} />
        ) : null}
        {!hasSearch && activeTab === 'documents' ? (
          <BrainDocumentsTab documents={dataset.documents} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'meetings' ? (
          <BrainMeetingsTab meetings={dataset.meetings} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'decisions' ? (
          <BrainDecisionsTab decisions={dataset.decisions} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'prompts' ? (
          <BrainPromptsTab prompts={dataset.prompts} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'agents' ? (
          <BrainAgentsTab agents={dataset.agents} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'concepts' ? (
          <BrainConceptsTab concepts={dataset.concepts} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'timeline' ? (
          <BrainTimelineTab timeline={dataset.timeline} />
        ) : null}
        {!hasSearch && activeTab === 'people' ? (
          <BrainPeopleTab people={dataset.people} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'questions' ? (
          <BrainQuestionsTab questions={dataset.questions} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'memory' ? (
          <BrainMemoryTab memory={dataset.memory} onAdd={handleOpenAdd} />
        ) : null}
        {!hasSearch && activeTab === 'map' ? (
          <BrainMapTab nodes={dataset.mapNodes} edges={dataset.mapEdges} />
        ) : null}
      </div>

      {addModalOpen && addTabId && project ? (
        <BrainAddModal
          projectPath={project.path}
          tabId={addTabId}
          onClose={handleCloseAdd}
          onSaved={handleSaved}
        />
      ) : null}

      {linkTranscriptionsOpen && project ? (
        <BrainLinkTranscriptionsModal
          projectPath={project.path}
          onClose={handleCloseLinkTranscriptions}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

export const BrainView = memo(BrainViewComponent);
