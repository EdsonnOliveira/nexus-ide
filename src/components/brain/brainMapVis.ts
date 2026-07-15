import type { Options } from 'vis-network';
import type { BrainMapEdge, BrainMapNode } from '@/components/brain/brainTypes';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';

export const COMMUNITY_COLORS: Record<string, string> = {
  documents: BRAIN_ACCENTS.blue,
  meetings: BRAIN_ACCENTS.green,
  decisions: BRAIN_ACCENTS.amber,
  prompts: BRAIN_ACCENTS.pink,
  agents: BRAIN_ACCENTS.cyan,
  files: BRAIN_ACCENTS.slate,
  concepts: BRAIN_ACCENTS.purple,
};

export interface VisMapNode {
  id: string;
  label: string;
  group: string;
  color: string;
  title: string;
  size: number;
  font: { color: string; size: number; face: string };
  borderWidth: number;
  shadow: boolean;
}

export interface VisMapEdge {
  id: string;
  from: string;
  to: string;
  color: { color: string; opacity: number };
  width: number;
  smooth: boolean;
}

export function resolveCommunityColor(communityId: string): string {
  return COMMUNITY_COLORS[communityId] ?? BRAIN_ACCENTS.slate;
}

export function buildVisNodes(nodes: BrainMapNode[]): VisMapNode[] {
  return nodes.map((node) => {
    const color = resolveCommunityColor(node.communityId);

    return {
      id: node.id,
      label: node.label,
      group: node.communityId,
      color,
      title: `${node.label}\n${node.communityLabel} · ${node.kind}`,
      size: node.kind === 'concept' ? 18 : 12,
      font: {
        color: 'rgba(248, 250, 252, 0.92)',
        size: 12,
        face: 'Inter, system-ui, sans-serif',
      },
      borderWidth: 0,
      shadow: true,
    };
  });
}

export function buildVisEdges(edges: BrainMapEdge[]): VisMapEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    from: edge.sourceId,
    to: edge.targetId,
    color: { color: 'rgba(148, 163, 184, 0.55)', opacity: 0.55 },
    width: 1,
    smooth: false,
  }));
}

export function createBrainNetworkOptions(): Options {
  return {
    autoResize: true,
    interaction: {
      hover: true,
      tooltipDelay: 120,
      hideEdgesOnDrag: false,
      multiselect: false,
      navigationButtons: false,
      keyboard: false,
      zoomView: true,
      dragView: true,
    },
    nodes: {
      shape: 'dot',
      scaling: { min: 10, max: 28 },
      font: {
        color: 'rgba(248, 250, 252, 0.92)',
        size: 12,
        face: 'Inter, system-ui, sans-serif',
        strokeWidth: 0,
      },
      borderWidth: 0,
      shadow: {
        enabled: true,
        color: 'rgba(0, 0, 0, 0.45)',
        size: 12,
        x: 0,
        y: 0,
      },
    },
    edges: {
      color: {
        color: 'rgba(148, 163, 184, 0.45)',
        highlight: 'rgba(226, 232, 240, 0.85)',
        hover: 'rgba(226, 232, 240, 0.7)',
        opacity: 0.5,
      },
      width: 1,
      selectionWidth: 2,
      smooth: false,
    },
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
      forceAtlas2Based: {
        gravitationalConstant: -38,
        centralGravity: 0.012,
        springLength: 95,
        springConstant: 0.07,
        avoidOverlap: 0.7,
      },
      stabilization: {
        enabled: true,
        iterations: 180,
        updateInterval: 25,
        fit: true,
      },
    },
    layout: {
      improvedLayout: true,
      randomSeed: 42,
    },
  };
}
