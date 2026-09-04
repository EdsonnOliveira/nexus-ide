import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalCommandHint } from '@/types';
import {
  parseComposerMentionContext,
  searchComposerMentionMatches,
  type ComposerMentionMatch,
} from '@/utils/agentComposerMention';
import { useMissionStore } from '@/stores/useMissionStore';
import { listLivePeers } from '@/utils/missionLiveBus';
import {
  getMissionNodeDisplayName,
  getMissionNodeKind,
} from '@/utils/missionHelpers';
import { getBuiltinTemplateById } from '@/constants/agentTemplates';

interface UseAgentComposerMentionOptions {
  draft: string;
  caretIndex: number;
  projectPath: string;
  isVisible: boolean;
  skillHints: TerminalCommandHint[];
  paneId?: string | null;
}

export function useAgentComposerMention({
  draft,
  caretIndex,
  projectPath,
  isVisible,
  skillHints,
  paneId,
}: UseAgentComposerMentionOptions) {
  const [matches, setMatches] = useState<ComposerMentionMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const missions = useMissionStore((state) => state.missions);

  const missionNodeMatches = useMemo(() => {
    if (!paneId) {
      return [] as ComposerMentionMatch[];
    }

    for (const mission of missions) {
      const node = mission.nodes.find((entry) => entry.paneId === paneId);
      if (!node) {
        continue;
      }

      return listLivePeers(mission.id, node.id).map((peer) => {
        const peerNode = mission.nodes.find((entry) => entry.id === peer.nodeId);
        const template = peerNode
          ? getBuiltinTemplateById(peerNode.agentTemplateId)
          : undefined;
        const name = peerNode
          ? getMissionNodeDisplayName(peerNode, template?.name ?? peer.name)
          : peer.name;
        const kind = peerNode ? getMissionNodeKind(peerNode) : peer.kind;
        return {
          id: `mission-node:${peer.nodeId}`,
          kind: 'mission_node' as const,
          name,
          label: name,
          subtitle:
            kind === 'note'
              ? 'Nota Live'
              : kind === 'browser' ||
                  kind === 'emulator' ||
                  kind === 'terminal' ||
                  kind === 'api'
                ? 'Portal Live'
                : 'Agent Live',
          insertText: `@${name} `,
        };
      });
    }

    return [] as ComposerMentionMatch[];
  }, [missions, paneId]);

  const mentionContext = useMemo(
    () => parseComposerMentionContext(draft, caretIndex),
    [caretIndex, draft],
  );

  const mentionContextKey = mentionContext
    ? `${mentionContext.startIndex}:${mentionContext.query}`
    : null;
  const [dismissedContextKey, setDismissedContextKey] = useState<string | null>(null);

  useEffect(() => {
    setDismissedContextKey(null);
  }, [mentionContextKey]);

  const isOpen = Boolean(mentionContextKey) && dismissedContextKey !== mentionContextKey;

  useEffect(() => {
    if (!isVisible || !isOpen || !mentionContext) {
      setMatches([]);
      setActiveIndex(0);
      setIsLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);

    const timeoutId = window.setTimeout(() => {
      void searchComposerMentionMatches(
        projectPath,
        mentionContext.query,
        skillHints,
        mentionContext.trigger,
        missionNodeMatches,
      ).then((nextMatches) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setMatches(nextMatches);
        setActiveIndex(0);
        setIsLoading(false);
      });
    }, 140);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isOpen, isVisible, mentionContext, missionNodeMatches, projectPath, skillHints]);

  const moveActiveIndex = useCallback(
    (direction: -1 | 1) => {
      if (matches.length === 0) {
        return;
      }

      setActiveIndex((prev) => {
        const next = direction === 1 ? prev + 1 : prev - 1;

        if (next < 0) {
          return matches.length - 1;
        }

        if (next >= matches.length) {
          return 0;
        }

        return next;
      });
    },
    [matches.length],
  );

  const moveDown = useCallback(() => {
    moveActiveIndex(1);
  }, [moveActiveIndex]);

  const moveUp = useCallback(() => {
    moveActiveIndex(-1);
  }, [moveActiveIndex]);

  const getActiveMatch = useCallback((): ComposerMentionMatch | null => {
    if (!isOpen || matches.length === 0) {
      return null;
    }

    return matches[activeIndex] ?? matches[0] ?? null;
  }, [activeIndex, isOpen, matches]);

  const dismiss = useCallback(() => {
    if (mentionContextKey) {
      setDismissedContextKey(mentionContextKey);
    }
  }, [mentionContextKey]);

  return {
    isOpen,
    isLoading,
    matches,
    activeIndex,
    mentionContext,
    moveDown,
    moveUp,
    getActiveMatch,
    dismiss,
  };
}
