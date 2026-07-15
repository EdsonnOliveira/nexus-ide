import type { BrainDocumentKind, BrainDecisionStatus } from '@/components/brain/brainTypes';
import type { BrainManualEditableTabId } from '@/utils/brainManualStore';

export const BRAIN_ADD_TAB_LABELS: Record<BrainManualEditableTabId, string> = {
  documents: 'documento',
  meetings: 'reunião',
  decisions: 'decisão',
  prompts: 'prompt',
  agents: 'agente',
  concepts: 'conceito',
  people: 'pessoa',
  questions: 'pergunta',
  memory: 'fato de memória',
};

export const BRAIN_ADD_MODAL_TITLES: Record<BrainManualEditableTabId, string> = {
  documents: 'Adicionar documento',
  meetings: 'Adicionar reunião',
  decisions: 'Adicionar decisão',
  prompts: 'Adicionar prompt',
  agents: 'Adicionar agente',
  concepts: 'Adicionar conceito',
  people: 'Adicionar pessoa',
  questions: 'Adicionar pergunta',
  memory: 'Adicionar memória',
};

export const BRAIN_DOCUMENT_KIND_OPTIONS: Array<{ value: BrainDocumentKind; label: string }> = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'pdf', label: 'PDF' },
  { value: 'openapi', label: 'OpenAPI' },
  { value: 'notion', label: 'Notion' },
  { value: 'figma', label: 'Figma' },
  { value: 'word', label: 'Word' },
  { value: 'wiki', label: 'Wiki' },
  { value: 'readme', label: 'README' },
];

export const BRAIN_DOCUMENT_STATUS_OPTIONS: Array<{
  value: 'indexed' | 'syncing' | 'outdated' | 'draft';
  label: string;
}> = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'indexed', label: 'Indexado' },
  { value: 'syncing', label: 'Sincronizando' },
  { value: 'outdated', label: 'Desatualizado' },
];

export const BRAIN_DECISION_STATUS_OPTIONS: Array<{ value: BrainDecisionStatus; label: string }> = [
  { value: 'proposed', label: 'Proposta' },
  { value: 'accepted', label: 'Aceita' },
  { value: 'superseded', label: 'Substituída' },
  { value: 'rejected', label: 'Rejeitada' },
];

export function splitCommaList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
