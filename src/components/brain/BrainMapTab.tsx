import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Waypoints } from 'lucide-react';
import { DataSet, Network } from 'vis-network/standalone';
import 'vis-network/styles/vis-network.min.css';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BrainMapCommunities } from '@/components/brain/BrainMapCommunities';
import { buildBrainMapCommunities } from '@/components/brain/brainSearch';
import {
  buildVisEdges,
  buildVisNodes,
  createBrainNetworkOptions,
  resolveCommunityColor,
  type VisMapEdge,
  type VisMapNode,
} from '@/components/brain/brainMapVis';
import type { BrainMapEdge, BrainMapNode } from '@/components/brain/brainTypes';

interface BrainMapTabProps {
  nodes: BrainMapNode[];
  edges: BrainMapEdge[];
}

function BrainMapTabComponent({ nodes, edges }: BrainMapTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDataRef = useRef<DataSet<VisMapNode, 'id'> | null>(null);
  const edgesDataRef = useRef<DataSet<VisMapEdge, 'id'> | null>(null);
  const mountedRef = useRef(false);

  const communities = useMemo(() => buildBrainMapCommunities(nodes), [nodes]);

  const [enabledIds, setEnabledIds] = useState<Set<string>>(() => new Set(communities.map((item) => item.id)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDegree, setSelectedDegree] = useState(0);

  useEffect(() => {
    setEnabledIds(new Set(communities.map((item) => item.id)));
  }, [communities]);

  const visibleNodes = useMemo(
    () => nodes.filter((node) => enabledIds.has(node.communityId)),
    [enabledIds, nodes],
  );

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId),
      ),
    [edges, visibleNodeIds],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const handleToggle = useCallback((communityId: string, enabled: boolean) => {
    setEnabledIds((current) => {
      const next = new Set(current);
      if (enabled) {
        next.add(communityId);
      } else {
        next.delete(communityId);
      }
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        setEnabledIds(new Set(communities.map((item) => item.id)));
        return;
      }

      setEnabledIds(new Set());
    },
    [communities],
  );

  useEffect(() => {
    const container = containerRef.current;

    if (!container || nodes.length === 0) {
      return;
    }

    const nodesData = new DataSet<VisMapNode, 'id'>([]);
    const edgesData = new DataSet<VisMapEdge, 'id'>([]);
    nodesDataRef.current = nodesData;
    edgesDataRef.current = edgesData;

    const network = new Network(
      container,
      { nodes: nodesData, edges: edgesData },
      createBrainNetworkOptions(),
    );
    networkRef.current = network;
    mountedRef.current = true;

    const handleClick = (params: { nodes: Array<string | number> }) => {
      const nodeId = params.nodes[0];

      if (nodeId === undefined) {
        setSelectedId(null);
        setSelectedDegree(0);
        network.unselectAll();
        return;
      }

      const id = String(nodeId);
      setSelectedId(id);

      const connected = network.getConnectedNodes(id);
      const connectedIds = Array.isArray(connected)
        ? connected.map((item) => String(item))
        : [];
      setSelectedDegree(connectedIds.length);

      network.selectNodes([id, ...connectedIds]);
      network.selectEdges(network.getConnectedEdges(id));
    };

    network.on('click', handleClick);

    const resizeObserver = new ResizeObserver(() => {
      network.redraw();
      network.setSize(`${container.clientWidth}px`, `${container.clientHeight}px`);
    });
    resizeObserver.observe(container);

    return () => {
      mountedRef.current = false;
      resizeObserver.disconnect();
      network.off('click', handleClick);
      network.destroy();
      networkRef.current = null;
      nodesDataRef.current = null;
      edgesDataRef.current = null;
    };
  }, [nodes.length]);

  useEffect(() => {
    const network = networkRef.current;
    const nodesData = nodesDataRef.current;
    const edgesData = edgesDataRef.current;

    if (!network || !nodesData || !edgesData || !mountedRef.current) {
      return;
    }

    nodesData.clear();
    edgesData.clear();
    nodesData.add(buildVisNodes(visibleNodes));
    edgesData.add(buildVisEdges(visibleEdges));

    if (selectedId && !visibleNodeIds.has(selectedId)) {
      setSelectedId(null);
      setSelectedDegree(0);
      network.unselectAll();
    }

    network.stabilize(60);
  }, [visibleEdges, visibleNodeIds, visibleNodes]);

  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={Waypoints}
        title='Mapa vazio'
        message='O grafo vivo do conhecimento aparecerá aqui.'
        className='brain-empty'
      />
    );
  }

  return (
    <div className='brain-map app-button--enter'>
      <div className='brain-map__layout'>
        <div className='brain-map__canvas-wrap'>
          <div ref={containerRef} className='brain-map__canvas' role='img' aria-label='Mapa do conhecimento' />
        </div>
        <BrainMapCommunities
          communities={communities}
          enabledIds={enabledIds}
          onToggle={handleToggle}
          onToggleAll={handleToggleAll}
        />
      </div>
      {selectedNode ? (
        <p className='brain-map__hint'>
          <span
            className='brain-map__hint-dot'
            style={{ backgroundColor: resolveCommunityColor(selectedNode.communityId) }}
            aria-hidden='true'
          />
          Foco em <strong>{selectedNode.label}</strong> · {selectedNode.communityLabel} ·{' '}
          {selectedDegree} conexões — clique no vazio para limpar.
        </p>
      ) : (
        <p className='brain-map__hint'>
          Arraste, zoom e clique em um nó para destacar a vizinhança. Filtre comunidades na lateral.
        </p>
      )}
    </div>
  );
}

export const BrainMapTab = memo(BrainMapTabComponent);
