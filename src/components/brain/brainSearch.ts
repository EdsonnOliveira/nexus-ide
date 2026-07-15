import type { BrainDataset, BrainSearchHit } from '@/components/brain/brainTypes';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';

export function searchBrainDataset(query: string, data: BrainDataset): BrainSearchHit[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  const hits: BrainSearchHit[] = [];

  data.documents.forEach((item) => {
    if (
      [item.name, item.aiSummary, item.tags.join(' '), item.related.join(' ')].join(' ').toLowerCase().includes(normalized)
    ) {
      hits.push({
        id: item.id,
        kind: 'document',
        title: item.name,
        subtitle: item.aiSummary,
        tabId: 'documents',
      });
    }
  });

  data.meetings.forEach((item) => {
    if ([item.title, item.summary, item.decisions.join(' ')].join(' ').toLowerCase().includes(normalized)) {
      hits.push({
        id: item.id,
        kind: 'meeting',
        title: item.title,
        subtitle: item.summary,
        tabId: 'meetings',
      });
    }
  });

  data.decisions.forEach((item) => {
    if ([item.title, item.reason, item.chosen, item.alternatives.join(' ')].join(' ').toLowerCase().includes(normalized)) {
      hits.push({
        id: item.id,
        kind: 'decision',
        title: item.title,
        subtitle: item.reason,
        tabId: 'decisions',
      });
    }
  });

  data.prompts.forEach((item) => {
    if ([item.title, item.result, item.related.join(' ')].join(' ').toLowerCase().includes(normalized)) {
      hits.push({
        id: item.id,
        kind: 'prompt',
        title: item.title,
        subtitle: item.result,
        tabId: 'prompts',
      });
    }
  });

  data.agents.forEach((item) => {
    if ([item.name, item.mission, item.summary].join(' ').toLowerCase().includes(normalized)) {
      hits.push({
        id: item.id,
        kind: 'agent',
        title: item.name,
        subtitle: item.mission,
        tabId: 'agents',
      });
    }
  });

  data.concepts.forEach((item) => {
    if ([item.name, item.summary, item.faqs.join(' ')].join(' ').toLowerCase().includes(normalized)) {
      hits.push({
        id: item.id,
        kind: 'concept',
        title: item.name,
        subtitle: item.summary,
        tabId: 'concepts',
      });
    }
  });

  data.people.forEach((item) => {
    if ([item.name, item.specialties.join(' '), item.decisions.join(' ')].join(' ').toLowerCase().includes(normalized)) {
      hits.push({
        id: item.id,
        kind: 'person',
        title: item.name,
        subtitle: item.specialties.join(', '),
        tabId: 'people',
      });
    }
  });

  data.questions.forEach((item) => {
    if ([item.question, item.answer].join(' ').toLowerCase().includes(normalized)) {
      hits.push({
        id: item.id,
        kind: 'question',
        title: item.question,
        subtitle: item.answer,
        tabId: 'questions',
      });
    }
  });

  data.memory.forEach((item) => {
    if (
      [item.title, item.fields.map((field) => `${field.label} ${field.value}`).join(' '), item.origins.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    ) {
      hits.push({
        id: item.id,
        kind: 'memory',
        title: item.title,
        subtitle: item.fields.map((field) => `${field.label}: ${field.value}`).join(' · '),
        tabId: 'memory',
      });
    }
  });

  return hits;
}

export function groupSearchHits(hits: BrainSearchHit[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();

  hits.forEach((hit) => {
    const labels: Record<BrainSearchHit['kind'], string> = {
      document: 'documentos',
      meeting: 'reuniões',
      decision: 'decisões',
      prompt: 'prompts',
      agent: 'agentes',
      concept: 'conceitos',
      file: 'arquivos',
      person: 'pessoas',
      question: 'perguntas',
      memory: 'memórias',
    };
    const label = labels[hit.kind];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

export function buildBrainMapCommunities(
  nodes: BrainDataset['mapNodes'],
): Array<{ id: string; label: string; color: string; count: number }> {
  const colorByCommunity: Record<string, string> = {
    documents: BRAIN_ACCENTS.blue,
    meetings: BRAIN_ACCENTS.green,
    decisions: BRAIN_ACCENTS.amber,
    prompts: BRAIN_ACCENTS.pink,
    agents: BRAIN_ACCENTS.cyan,
    files: BRAIN_ACCENTS.slate,
    concepts: BRAIN_ACCENTS.purple,
  };

  const counts = new Map<string, { label: string; count: number }>();

  nodes.forEach((node) => {
    const current = counts.get(node.communityId);
    if (current) {
      current.count += 1;
      return;
    }

    counts.set(node.communityId, { label: node.communityLabel, count: 1 });
  });

  return Array.from(counts.entries()).map(([id, value]) => ({
    id,
    label: value.label,
    color: colorByCommunity[id] ?? BRAIN_ACCENTS.slate,
    count: value.count,
  }));
}
