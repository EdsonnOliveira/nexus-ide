import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import type { MissionDrawing, MissionDrawingKind } from '@/types/mission';
import { useMissionStore } from '@/stores/useMissionStore';

interface MissionDrawingLayerProps {
  missionId: string;
  tool: MissionDrawingKind | null;
  selectedDrawingIds?: string[];
  color?: string;
}

function MissionDrawingLayerComponent({
  missionId,
  tool,
  selectedDrawingIds = [],
  color = '#60a5fa',
}: MissionDrawingLayerProps) {
  const drawings = useMissionStore(
    (state) =>
      state.missions.find((mission) => mission.id === missionId)?.drawings ?? [],
  );
  const updateMission = useMissionStore((state) => state.updateMission);
  const { screenToFlowPosition } = useReactFlow();
  const { x, y, zoom } = useViewport();
  const [draft, setDraft] = useState<MissionDrawing | null>(null);
  const draftRef = useRef<MissionDrawing | null>(null);
  const drawingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const selectedDrawingIdSet = useMemo(
    () => new Set(selectedDrawingIds),
    [selectedDrawingIds],
  );

  const allDrawings = useMemo(
    () => (draft ? [...drawings, draft] : drawings),
    [draft, drawings],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!tool) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
      }
      const flow = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const next: MissionDrawing = {
        id: crypto.randomUUID(),
        kind: tool,
        points: [flow, flow],
        color,
        strokeWidth: 2.5 / Math.max(zoom, 0.2),
      };
      drawingRef.current = true;
      draftRef.current = next;
      setDraft(next);
    },
    [color, screenToFlowPosition, tool, zoom],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current || !draftRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const flow = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const current = draftRef.current;
      const next: MissionDrawing =
        current.kind === 'path'
          ? { ...current, points: [...current.points, flow] }
          : { ...current, points: [current.points[0] ?? flow, flow] };
      draftRef.current = next;
      setDraft(next);
    },
    [screenToFlowPosition],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
      }
      drawingRef.current = false;
      const finished = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (!finished || finished.points.length < 1) {
        return;
      }
      const a = finished.points[0];
      const b = finished.points[finished.points.length - 1];
      if (
        finished.kind !== 'path' &&
        a &&
        b &&
        Math.hypot(b.x - a.x, b.y - a.y) < 4
      ) {
        return;
      }
      if (finished.kind === 'path' && finished.points.length < 2) {
        return;
      }

      const currentDrawings =
        useMissionStore.getState().missions.find((mission) => mission.id === missionId)
          ?.drawings ?? [];
      const nextDrawings = [...currentDrawings, finished];
      useMissionStore.setState((state) => ({
        missions: state.missions.map((entry) =>
          entry.id === missionId ? { ...entry, drawings: nextDrawings } : entry,
        ),
      }));
      void updateMission(missionId, { drawings: nextDrawings });
    },
    [missionId, updateMission],
  );

  return (
    <svg
      ref={svgRef}
      className={`mission-drawing-layer${tool ? ' mission-drawing-layer--active' : ''}`}
      width='100%'
      height='100%'
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <g transform={`translate(${x}, ${y}) scale(${zoom})`}>
        {allDrawings.map((drawing) => {
          const isSelected = selectedDrawingIdSet.has(drawing.id);
          const stroke = isSelected ? '#fbbf24' : drawing.color || color;
          const strokeWidth = isSelected
            ? (drawing.strokeWidth || 2) + 1.5
            : drawing.strokeWidth || 2;

          if (drawing.kind === 'rect' && drawing.points.length >= 2) {
            const a = drawing.points[0];
            const b = drawing.points[1];
            const left = Math.min(a.x, b.x);
            const top = Math.min(a.y, b.y);
            const width = Math.abs(b.x - a.x);
            const height = Math.abs(b.y - a.y);
            return (
              <rect
                key={drawing.id}
                x={left}
                y={top}
                width={width}
                height={height}
                fill={isSelected ? 'rgba(251, 191, 36, 0.12)' : 'rgba(96, 165, 250, 0.08)'}
                stroke={stroke}
                strokeWidth={strokeWidth}
                vectorEffect='non-scaling-stroke'
              />
            );
          }

          if (drawing.kind === 'arrow' && drawing.points.length >= 2) {
            const a = drawing.points[0];
            const b = drawing.points[1];
            return (
              <line
                key={drawing.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={stroke}
                strokeWidth={strokeWidth}
                markerEnd={isSelected ? 'url(#mission-arrow-head-selected)' : 'url(#mission-arrow-head)'}
                vectorEffect='non-scaling-stroke'
              />
            );
          }

          const d = drawing.points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
            .join(' ');
          return (
            <path
              key={drawing.id}
              d={d}
              fill='none'
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeLinecap='round'
              strokeLinejoin='round'
              vectorEffect='non-scaling-stroke'
            />
          );
        })}
      </g>
      <defs>
        <marker
          id='mission-arrow-head-selected'
          markerWidth='8'
          markerHeight='8'
          refX='6'
          refY='3'
          orient='auto'
          markerUnits='strokeWidth'
        >
          <path d='M0,0 L6,3 L0,6 Z' fill='#fbbf24' />
        </marker>
        <marker
          id='mission-arrow-head'
          markerWidth='8'
          markerHeight='8'
          refX='6'
          refY='3'
          orient='auto'
          markerUnits='strokeWidth'
        >
          <path d='M0,0 L6,3 L0,6 Z' fill={color} />
        </marker>
      </defs>
    </svg>
  );
}

export const MissionDrawingLayer = memo(MissionDrawingLayerComponent);
