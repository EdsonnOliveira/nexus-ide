import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import logoAndroid from '@/assets/logo-android.svg';
import logoApple from '@/assets/logo-apple.svg';
import logoAntigravity from '@/assets/logo-antigravity.svg';
import logoClaude from '@/assets/logo-claude.svg';
import logoCodex from '@/assets/logo-codex.svg';
import logoCursor from '@/assets/logo-cursor.svg';
import logoExpo from '@/assets/logo-expo.svg';
import logoGemini from '@/assets/logo-gemini.svg';
import logoOpencode from '@/assets/logo-opencode.svg';
import iconModeAgent from '@/assets/icon-mode-agent.svg';
import iconModeAsk from '@/assets/icon-mode-ask.svg';
import iconModeDebug from '@/assets/icon-mode-debug.svg';
import iconModeMultitask from '@/assets/icon-mode-multitask.svg';
import iconModePlan from '@/assets/icon-mode-plan.svg';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { TerminalQuickCommandPills } from '@/components/terminal/TerminalQuickCommandPills';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { useHomeAgentQueue } from '@/hooks/useHomeAgentBindings';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { readLogoDataUrl } from '@/utils/agentPipSnapshot';
import { listOpenMaestroAgentProjects } from '@/utils/homeDashboardAgents';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';
import { shouldShowAgentSkillHints } from '@/utils/parseAgentModeCommand';
import {
  buildMaestroQuickCommandHints,
  isStandaloneTerminalProjectId,
  mergeStandaloneTerminalHints,
} from '@/utils/standaloneTerminalHints';
import { PROJECT_COLORS, type TerminalCommandHint, type TerminalTab } from '@/types';

interface TerminalFooterProps {
  tab: TerminalTab;
  projectId: string;
  cwd: string;
  isVisible: boolean;
  keyboardActive: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onDismissKeyboard: (focusTerminal?: boolean) => void;
  onHintsCountChange: (count: number) => void;
  onRunCommand: (command: string) => void;
}

const HINT_BADGE_ICON_SRC = {
  expo: logoExpo,
  apple: logoApple,
  android: logoAndroid,
  cursor: logoCursor,
  claude: logoClaude,
  opencode: logoOpencode,
  antigravity: logoAntigravity,
  codex: logoCodex,
  gemini: logoGemini,
  'mode-agent': iconModeAgent,
  'mode-plan': iconModePlan,
  'mode-ask': iconModeAsk,
  'mode-debug': iconModeDebug,
  'mode-multitask': iconModeMultitask,
} as const;

const HINT_BADGE_COLORS = {
  expo: '#7c3aed',
  apple: '#2563eb',
  android: '#059669',
  cursor: '#1a1a1a',
  claude: '#cc785c',
  opencode: '#6366f1',
  antigravity: '#7c3aed',
  codex: '#10a37f',
  gemini: '#1c69ff',
} as const;

const HINT_GROUP_ORDER = ['mode', 'model', 'skill'] as const;

type HintBadgeItem = {
  hint: TerminalCommandHint;
  hintKind: 'skill' | 'mode' | 'model' | undefined;
  backgroundColor: string;
  iconSrc: string | null;
  logoSrc: string | null;
  projectIcon: string | null;
  globalIndex: number;
};

type HintRow = {
  kind: (typeof HINT_GROUP_ORDER)[number] | 'default';
  items: HintBadgeItem[];
};

const HINT_ROW_GAP = 6;

interface TerminalFooterHintRowProps {
  items: HintBadgeItem[];
  isVisible: boolean;
  renderHintButton: (item: HintBadgeItem) => ReactNode;
  onVisibleCountChange: (count: number) => void;
  preserveAllItems?: boolean;
}

function TerminalFooterHintRowComponent({
  items,
  isVisible,
  renderHintButton,
  onVisibleCountChange,
  preserveAllItems = false,
}: TerminalFooterHintRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  const measureVisibleCount = useCallback(() => {
    const row = rowRef.current;

    if (!row) {
      return;
    }

    if (preserveAllItems) {
      const slots = Array.from(row.children) as HTMLElement[];

      for (const slot of slots) {
        slot.style.display = '';
      }

      setVisibleCount((prev) => (prev === items.length ? prev : items.length));
      onVisibleCountChange(items.length);
      return;
    }

    const slots = Array.from(row.children) as HTMLElement[];

    for (const slot of slots) {
      slot.style.display = '';
    }

    const rowWidth = row.clientWidth;

    if (rowWidth <= 0) {
      setVisibleCount((prev) => (prev === items.length ? prev : items.length));
      onVisibleCountChange(items.length);
      return;
    }

    let used = 0;
    let count = 0;

    for (const slot of slots) {
      const width = slot.getBoundingClientRect().width;
      const next = count === 0 ? width : used + HINT_ROW_GAP + width;

      if (next > rowWidth + 1) {
        break;
      }

      used = next;
      count += 1;
    }

    for (const [index, slot] of slots.entries()) {
      slot.style.display = index < count ? '' : 'none';
    }

    setVisibleCount((prev) => (prev === count ? prev : count));
    onVisibleCountChange(count);
  }, [items, onVisibleCountChange, preserveAllItems]);

  useLayoutEffect(() => {
    if (!isVisible) {
      return;
    }

    measureVisibleCount();

    const row = rowRef.current;

    if (!row) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureVisibleCount();
    });

    observer.observe(row);

    return () => {
      observer.disconnect();
    };
  }, [isVisible, measureVisibleCount]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const row = rowRef.current;

    if (!row || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }

    if (row.scrollWidth <= row.clientWidth) {
      return;
    }

    event.preventDefault();
    row.scrollLeft += event.deltaY;
  }, []);

  return (
    <div
      ref={rowRef}
      className={`terminal-footer__hint-row${preserveAllItems ? ' terminal-footer__hint-row--mode' : ''}`}
      role='group'
      onWheel={handleWheel}
    >
      {items.map((item, index) => (
        <div
          key={item.hint.id}
          className='terminal-footer__hint-slot'
          style={index >= visibleCount ? { display: 'none' } : undefined}
        >
          {renderHintButton(item)}
        </div>
      ))}
    </div>
  );
}

const TerminalFooterHintRow = memo(TerminalFooterHintRowComponent);

function TerminalFooterComponent({
  tab,
  projectId,
  cwd,
  isVisible,
  keyboardActive,
  activeIndex,
  onActiveIndexChange,
  onDismissKeyboard,
  onHintsCountChange,
  onRunCommand,
}: TerminalFooterProps) {
  const [hints, setHints] = useState<TerminalCommandHint[]>([]);
  const [logoSrcByPath, setLogoSrcByPath] = useState<Record<string, string>>({});
  const hintRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hintsRef = useRef<TerminalCommandHint[]>([]);
  const visibleHintIndicesRef = useRef<number[]>([]);
  const activeIndexRef = useRef(activeIndex);
  const footerRef = useRef<HTMLElement>(null);
  const rowVisibleCountsRef = useRef<Record<string, number>>({});
  const [visibleCountsVersion, setVisibleCountsVersion] = useState(0);
  const projects = useProjectStore((state) => state.projects);
  const homeAgentQueue = useHomeAgentQueue();
  const isStandaloneTerminal = isStandaloneTerminalProjectId(projectId);
  const maestroHintProjects = useMemo(() => {
    if (!isStandaloneTerminal) {
      return [];
    }

    return listOpenMaestroAgentProjects(projects, homeAgentQueue);
  }, [homeAgentQueue, isStandaloneTerminal, projects]);
  const activeAgentCommand = useTerminalSessionStore(
    (state) => state.activeAgentByPane[tab.id] ?? null,
  );
  const activeAgentMode = useTerminalSessionStore(
    (state) => state.activeAgentModeByPane[tab.id] ?? 'agent',
  );
  const showSkillHints = shouldShowAgentSkillHints(activeAgentMode);
  const useAgentHints = Boolean(activeAgentCommand);

  const handleRowVisibleCountChange = useCallback((rowKey: string, count: number) => {
    if (rowVisibleCountsRef.current[rowKey] === count) {
      return;
    }

    rowVisibleCountsRef.current[rowKey] = count;
    setVisibleCountsVersion((version) => version + 1);
  }, []);

  const visibleHints = useMemo(() => {
    if (showSkillHints) {
      return hints;
    }

    return hints.filter((hint) => {
      const hintKind = hint.hintKind ?? (hint.id.startsWith('skill-') ? 'skill' : undefined);

      return hintKind !== 'skill';
    });
  }, [hints, showSkillHints]);

  useEffect(() => {
    hintsRef.current = visibleHints;
  }, [visibleHints]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    let cancelled = false;

    const loadHints = async () => {
      if (useAgentHints) {
        const entries = await window.nexus.files.getAgentSkillHints(cwd);

        if (!cancelled) {
          setHints(entries);
        }

        return;
      }

      const cwdEntries = await window.nexus.files.getTerminalHints(cwd);

      if (!isStandaloneTerminal || maestroHintProjects.length === 0) {
        if (!cancelled) {
          setHints(cwdEntries);
        }

        return;
      }

      const projectHintGroups = await Promise.all(
        maestroHintProjects.map(async (project) => {
          try {
            const hintsForProject = await window.nexus.files.getTerminalHints(project.path);

            return { project, hints: hintsForProject };
          } catch {
            return { project, hints: [] as TerminalCommandHint[] };
          }
        }),
      );
      const quickCommandHints = buildMaestroQuickCommandHints(maestroHintProjects, cwd);

      if (!cancelled) {
        setHints(
          mergeStandaloneTerminalHints(cwdEntries, projectHintGroups, cwd, quickCommandHints),
        );
      }
    };

    void loadHints();

    return () => {
      cancelled = true;
    };
  }, [cwd, isStandaloneTerminal, isVisible, maestroHintProjects, tab.id, useAgentHints]);

  useEffect(() => {
    if (!isVisible || !tab.restoreCommand) {
      return;
    }

    const fromRestore = extractCliAgentCommand(tab.restoreCommand);

    if (!fromRestore) {
      return;
    }

    const current = useTerminalSessionStore.getState().activeAgentByPane[tab.id];

    if (current !== fromRestore) {
      useTerminalSessionStore.getState().setActiveAgent(tab.id, fromRestore);
    }
  }, [isVisible, tab.id, tab.restoreCommand]);

  useEffect(() => {
    if (!keyboardActive) {
      return;
    }

    const activeHint = hintRefs.current[activeIndex];

    if (activeHint) {
      activeHint.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeIndex, keyboardActive]);

  useEffect(() => {
    if (!keyboardActive || visibleHints.length === 0) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isOverlayBlockingTerminalHints()) {
        return;
      }

      const currentHints = hintsRef.current;

      if (currentHints.length === 0) {
        return;
      }

      const visibleIndices = visibleHintIndicesRef.current;

      if (visibleIndices.length === 0) {
        return;
      }

      const moveToIndex = (nextIndex: number) => {
        event.preventDefault();
        event.stopPropagation();
        activeIndexRef.current = nextIndex;
        onActiveIndexChange(nextIndex);
      };

      const currentPosition = visibleIndices.indexOf(activeIndexRef.current);
      const resolvedPosition = currentPosition === -1 ? 0 : currentPosition;

      if (event.key === 'ArrowRight') {
        const nextPosition = (resolvedPosition + 1) % visibleIndices.length;
        moveToIndex(visibleIndices[nextPosition] ?? 0);
        return;
      }

      if (event.key === 'ArrowLeft') {
        const nextPosition = (resolvedPosition - 1 + visibleIndices.length) % visibleIndices.length;
        moveToIndex(visibleIndices[nextPosition] ?? 0);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        onDismissKeyboard();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const hint = currentHints[activeIndexRef.current];

        if (hint) {
          onRunCommand(hint.command);
          onDismissKeyboard();
        }

        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismissKeyboard();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [keyboardActive, onActiveIndexChange, onDismissKeyboard, onRunCommand]);

  useEffect(() => {
    if (!keyboardActive) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (footerRef.current?.contains(target)) {
        return;
      }

      onDismissKeyboard(false);
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [keyboardActive, onDismissKeyboard]);

  const handleHintClick = useCallback(
    (hintCommand: string) => {
      onRunCommand(hintCommand);
      onDismissKeyboard();
    },
    [onDismissKeyboard, onRunCommand],
  );

  useEffect(() => {
    rowVisibleCountsRef.current = {};
    setVisibleCountsVersion((version) => version + 1);
  }, [hints, isVisible, useAgentHints, showSkillHints]);

  const badgeLogoPathsKey = useMemo(() => {
    const paths = new Set<string>();

    for (const hint of visibleHints) {
      const logo = hint.badgeLogo?.trim();

      if (logo) {
        paths.add(logo);
      }
    }

    return Array.from(paths).sort().join('\0');
  }, [visibleHints]);

  useEffect(() => {
    if (!badgeLogoPathsKey) {
      setLogoSrcByPath({});
      return;
    }

    let cancelled = false;
    const paths = badgeLogoPathsKey.split('\0').filter(Boolean);

    void Promise.all(
      paths.map(async (logoPath) => {
        const dataUrl = await readLogoDataUrl(logoPath);
        return [logoPath, dataUrl] as const;
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      const next: Record<string, string> = {};

      for (const [logoPath, dataUrl] of entries) {
        if (dataUrl) {
          next[logoPath] = dataUrl;
        }
      }

      setLogoSrcByPath(next);
    });

    return () => {
      cancelled = true;
    };
  }, [badgeLogoPathsKey]);

  const hintBadges = useMemo(
    () =>
      visibleHints.map((hint, index) => {
        const badgeIcon = hint.badgeIcon;
        const hintKind = hint.hintKind ?? (hint.id.startsWith('skill-') ? 'skill' : undefined);
        const logoPath = hint.badgeLogo?.trim() || '';
        const hasProjectBadge = Boolean(logoPath || hint.badgeProjectIcon);
        const backgroundColor = hasProjectBadge
          ? (hint.badgeColor ?? PROJECT_COLORS[index % PROJECT_COLORS.length])
          : (hint.badgeColor ??
            (badgeIcon && badgeIcon in HINT_BADGE_COLORS
              ? HINT_BADGE_COLORS[badgeIcon as keyof typeof HINT_BADGE_COLORS]
              : PROJECT_COLORS[index % PROJECT_COLORS.length]));

        return {
          hint,
          hintKind,
          backgroundColor,
          iconSrc: badgeIcon ? HINT_BADGE_ICON_SRC[badgeIcon] : null,
          logoSrc: logoPath ? (logoSrcByPath[logoPath] ?? null) : null,
          projectIcon: hint.badgeProjectIcon ?? null,
          globalIndex: index,
        };
      }),
    [logoSrcByPath, visibleHints],
  );

  const hintRows = useMemo((): HintRow[] => {
    const hasAgentHintKinds = hintBadges.some(
      (item) => item.hintKind === 'mode' || item.hintKind === 'model' || item.hintKind === 'skill',
    );

    if (!useAgentHints || !hasAgentHintKinds) {
      return [{ kind: 'default', items: hintBadges }];
    }

    const grouped = new Map<(typeof HINT_GROUP_ORDER)[number], HintBadgeItem[]>();

    for (const item of hintBadges) {
      if (item.hintKind !== 'mode' && item.hintKind !== 'model' && item.hintKind !== 'skill') {
        continue;
      }

      const row = grouped.get(item.hintKind) ?? [];
      row.push(item);
      grouped.set(item.hintKind, row);
    }

    return HINT_GROUP_ORDER.flatMap((kind) => {
      const items = grouped.get(kind) ?? [];

      if (items.length === 0) {
        return [];
      }

      return [{ kind, items }];
    });
  }, [hintBadges, useAgentHints]);

  const visibleHintIndices = useMemo(() => {
    void visibleCountsVersion;

    return hintRows.flatMap((row) => {
      const visibleCount = rowVisibleCountsRef.current[row.kind] ?? row.items.length;

      return row.items.slice(0, visibleCount).map((item) => item.globalIndex);
    });
  }, [hintRows, visibleCountsVersion]);

  useEffect(() => {
    visibleHintIndicesRef.current = visibleHintIndices;
    onHintsCountChange(visibleHintIndices.length);
  }, [onHintsCountChange, visibleHintIndices]);

  useEffect(() => {
    if (visibleHintIndices.length === 0) {
      return;
    }

    if (!visibleHintIndices.includes(activeIndex)) {
      onActiveIndexChange(visibleHintIndices[visibleHintIndices.length - 1] ?? 0);
    }
  }, [activeIndex, onActiveIndexChange, visibleHintIndices]);

  const renderHintButton = useCallback(
    ({ hint, hintKind, backgroundColor, iconSrc, logoSrc, projectIcon, globalIndex }: HintBadgeItem) => {
      const hasProjectLogo = Boolean(logoSrc);
      const hasProjectIcon = Boolean(projectIcon) && !hasProjectLogo;
      const hasBuiltinIcon = Boolean(iconSrc) && !hasProjectLogo && !hasProjectIcon;

      return (
        <button
          key={hint.id}
          ref={(element) => {
            hintRefs.current[globalIndex] = element;
          }}
          type='button'
          className={`terminal-footer__hint app-button${hintKind ? ` terminal-footer__hint--${hintKind}` : ''}${keyboardActive && globalIndex === activeIndex ? ' terminal-footer__hint--active' : ''}`}
          role='option'
          aria-selected={keyboardActive && globalIndex === activeIndex}
          aria-label={`${hint.badge} ${hint.label}`}
          onMouseEnter={() => {
            if (keyboardActive) {
              onActiveIndexChange(globalIndex);
            }
          }}
          onClick={() => handleHintClick(hint.command)}
        >
          <span
            className={`terminal-footer__hint-badge${hasProjectLogo || hasProjectIcon || hasBuiltinIcon ? ' terminal-footer__hint-badge--icon' : ''}${hasProjectLogo ? ' terminal-footer__hint-badge--logo' : ''}${hintKind ? ` terminal-footer__hint-badge--${hintKind}` : ''}`}
            style={hasProjectLogo ? undefined : { backgroundColor }}
          >
            {hasProjectLogo ? (
              <img
                src={logoSrc!}
                alt=''
                className='terminal-footer__hint-badge-logo'
                draggable={false}
              />
            ) : hasProjectIcon ? (
              <ProjectIconMark icon={projectIcon!} size={11} strokeWidth={2.25} />
            ) : hasBuiltinIcon ? (
              <img src={iconSrc!} alt='' className='terminal-footer__hint-badge-icon' draggable={false} />
            ) : (
              hint.badge
            )}
          </span>
          <span className='terminal-footer__hint-label'>{hint.label}</span>
        </button>
      );
    },
    [activeIndex, handleHintClick, keyboardActive, onActiveIndexChange],
  );

  if (visibleHints.length === 0) {
    return (
      <footer ref={footerRef} className={`terminal-footer terminal-footer--${tab.agent}`}>
        <TerminalQuickCommandPills projectId={projectId} onRunCommand={onRunCommand} />
      </footer>
    );
  }

  return (
    <footer
      ref={footerRef}
      className={`terminal-footer terminal-footer--${tab.agent}`}
    >
      <TerminalQuickCommandPills projectId={projectId} onRunCommand={onRunCommand} />
      <div className='terminal-footer__hints' role='listbox' aria-label='Sugestões do terminal'>
        {hintRows.map((row) => (
          <TerminalFooterHintRow
            key={row.kind}
            items={row.items}
            isVisible={isVisible}
            renderHintButton={renderHintButton}
            onVisibleCountChange={(count) => handleRowVisibleCountChange(row.kind, count)}
            preserveAllItems
          />
        ))}
      </div>
    </footer>
  );
}

export const TerminalFooter = memo(TerminalFooterComponent);
