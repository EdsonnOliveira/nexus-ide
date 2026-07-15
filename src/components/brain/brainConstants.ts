import type { BrainKnowledgeTabId } from '@/components/brain/brainTypes';

export const BRAIN_KNOWLEDGE_TABS: Array<{ id: BrainKnowledgeTabId; label: string }> = [
  { id: 'summary', label: 'Resumo' },
  { id: 'documents', label: 'Documentação' },
  { id: 'meetings', label: 'Reuniões' },
  { id: 'decisions', label: 'Decisões' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'agents', label: 'Agentes' },
  { id: 'concepts', label: 'Conhecimento' },
  { id: 'timeline', label: 'Linha do Tempo' },
  { id: 'people', label: 'Pessoas' },
  { id: 'questions', label: 'Perguntas' },
  { id: 'memory', label: 'Memória' },
  { id: 'map', label: 'Mapa' },
];

export const BRAIN_SEARCH_EXAMPLES = [
  'Autenticação',
  'README',
  'Último prompt',
];
