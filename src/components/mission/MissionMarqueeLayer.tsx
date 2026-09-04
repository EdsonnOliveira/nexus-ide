import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useReactFlow, type Node } from '@xyflow/react';
import type { MissionDrawing } from '@/types/mission';
import {
  getMissionDrawingRect,
  getMissionFlowNodeRect,
  missionFlowRectsIntersect,
  type MissionFlowRect,
} from '@/utils/missionHelpers';

export interface MissionMarqueeLayerHandle {
  begin: (event: { clientX: number; clientY: number; pointerId: number }) => void;
}

export interface MissionMarqueeSelection {
  nodeIds: string[];
  drawingIds: string[];
}

interface MissionMarqueeLayerProps {
  enabled: boolean;
  flowNodes: Node[];
  drawings: MissionDrawing[];
  onSelect: (selection: MissionMarqueeSelection) => void;
  onMarqueeComplete: () => void;
}

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function normalizeScreenRect(a: { x: number; y: number }, b: { x: number; y: number }): ScreenRect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    x: left,
    y: top,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function normalizeFlowRect(a: { x: number; y: number }, b: { x: number; y: number }): MissionFlowRect {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    x: left,
    y: top,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

const MissionMarqueeLayerComponent = forwardRef<
  MissionMarqueeLayerHandle,
  MissionMarqueeLayerProps
>(function MissionMarqueeLayerComponent(
  { enabled, flowNodes, drawings, onSelect, onMarqueeComplete },
  ref,
) {
  const { screenToFlowPosition } = useReactFlow();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<ScreenRect | null>(null);

  const clientToLocal = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current;
    if (!host) {
      return { x: 0, y: 0 };
    }
    const bounds = host.getBoundingClientRect();
    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    };
  }, []);

  const finishMarquee = useCallback(
    (clientX: number, clientY: number) => {
      if (!draggingRef.current || !startRef.current) {
        return;
      }

      draggingRef.current = false;
      pointerIdRef.current = null;

      const host = hostRef.current;
      const start = startRef.current;
      startRef.current = null;
      const end = clientToLocal(clientX, clientY);
      const screenRect = normalizeScreenRect(start, end);
      setDraft(null);

      if (screenRect.width < 6 && screenRect.height < 6) {
        onSelect({ nodeIds: [], drawingIds: [] });
        return;
      }

      const hostBounds = host?.getBoundingClientRect();
      if (!hostBounds) {
        return;
      }

      const flowStart = screenToFlowPosition({
        x: hostBounds.left + screenRect.x,
        y: hostBounds.top + screenRect.y,
      });
      const flowEnd = screenToFlowPosition({
        x: hostBounds.left + screenRect.x + screenRect.width,
        y: hostBounds.top + screenRect.y + screenRect.height,
      });
      const selectionRect = normalizeFlowRect(flowStart, flowEnd);
      const selectedNodeIds = flowNodes
        .filter((node) => {
          if (node.data?.isMissionRoot) {
            return false;
          }
          return missionFlowRectsIntersect(selectionRect, getMissionFlowNodeRect(node));
        })
        .map((node) => node.id);
      const selectedDrawingIds = drawings
        .filter((drawing) =>
          missionFlowRectsIntersect(selectionRect, getMissionDrawingRect(drawing)),
        )
        .map((drawing) => drawing.id);

      onSelect({ nodeIds: selectedNodeIds, drawingIds: selectedDrawingIds });
      onMarqueeComplete();
    },
    [clientToLocal, drawings, flowNodes, onMarqueeComplete, onSelect, screenToFlowPosition],
  );

  const begin = useCallback(
    (event: { clientX: number; clientY: number; pointerId: number }) => {
      if (!enabled) {
        return;
      }

      const host = hostRef.current;
      if (!host) {
        return;
      }

      draggingRef.current = true;
      pointerIdRef.current = event.pointerId;
      const origin = clientToLocal(event.clientX, event.clientY);
      startRef.current = origin;
      setDraft({ x: origin.x, y: origin.y, width: 0, height: 0 });

      try {
        host.setPointerCapture(event.pointerId);
      } catch {
      }
    },
    [clientToLocal, enabled],
  );

  useImperativeHandle(ref, () => ({ begin }), [begin]);

  useEffect(() => {
    if (!enabled && draft) {
      draggingRef.current = false;
      startRef.current = null;
      pointerIdRef.current = null;
      setDraft(null);
    }
  }, [draft, enabled]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current || !startRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const current = clientToLocal(event.clientX, event.clientY);
      setDraft(normalizeScreenRect(startRef.current, current));
    },
    [clientToLocal],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
      }
      finishMarquee(event.clientX, event.clientY);
    },
    [finishMarquee],
  );

  const active = Boolean(draft);

  return (
    <div
      ref={hostRef}
      className={`mission-marquee-layer-host${active ? ' mission-marquee-layer-host--active' : ''}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {draft && draft.width > 0 && draft.height > 0 ? (
        <div
          className='mission-marquee-layer__rect'
          style={{
            left: draft.x,
            top: draft.y,
            width: draft.width,
            height: draft.height,
          }}
        />
      ) : null}
    </div>
  );
});

export const MissionMarqueeLayer = memo(MissionMarqueeLayerComponent);
