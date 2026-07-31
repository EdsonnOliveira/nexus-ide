import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WebAgentSkillHint } from './useWebAgentSkills';
import {
  filterWebSkillSlashMatches,
  parseWebSkillSlashContext,
  type WebSkillSlashMatch,
} from './webAgentSkillSlash';

export function useWebAgentSkillSlash(input: {
  value: string;
  caretIndex: number;
  skills: WebAgentSkillHint[];
  enabled?: boolean;
}) {
  const { value, caretIndex, skills, enabled = true } = input;
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const context = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return parseWebSkillSlashContext(value, caretIndex);
  }, [caretIndex, enabled, value]);

  const contextKey = context ? `${context.startIndex}:${context.query}` : null;

  useEffect(() => {
    setDismissedKey(null);
  }, [contextKey]);

  const isOpen = Boolean(contextKey) && dismissedKey !== contextKey;

  const matches = useMemo(() => {
    if (!isOpen || !context) {
      return [] as WebSkillSlashMatch[];
    }
    return filterWebSkillSlashMatches(skills, context.query);
  }, [context, isOpen, skills]);

  useEffect(() => {
    setActiveIndex(0);
  }, [contextKey, matches.length]);

  const moveDown = useCallback(() => {
    if (matches.length === 0) {
      return;
    }
    setActiveIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const moveUp = useCallback(() => {
    if (matches.length === 0) {
      return;
    }
    setActiveIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const getActiveMatch = useCallback((): WebSkillSlashMatch | null => {
    if (!isOpen || matches.length === 0) {
      return null;
    }
    return matches[activeIndex] ?? matches[0] ?? null;
  }, [activeIndex, isOpen, matches]);

  const dismiss = useCallback(() => {
    if (contextKey) {
      setDismissedKey(contextKey);
    }
  }, [contextKey]);

  return {
    isOpen,
    matches,
    activeIndex,
    context,
    moveDown,
    moveUp,
    getActiveMatch,
    dismiss,
  };
}
