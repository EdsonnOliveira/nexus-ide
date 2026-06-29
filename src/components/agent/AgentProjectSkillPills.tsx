import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Plus, X } from 'lucide-react';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectAgentResponseSkill, TerminalCommandHint } from '@/types';
import { submitAgentPanePrompt } from '@/utils/agentPaneRegistry';
import { buildAgentSkillPrompt } from '@/utils/agentCliSession';

const MAX_PROJECT_AGENT_RESPONSE_SKILLS = 3;

interface AgentProjectSkillPillsProps {
  projectId: string;
  projectPath: string;
  paneId: string;
  responseContent?: string;
  alwaysVisible?: boolean;
}

function shortenSkillLabel(label: string): string {
  return label.trim();
}

function AgentProjectSkillPickerMenu({
  anchorRect,
  triggerRef,
  items,
  onClose,
  onSelect,
}: {
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  items: TerminalCommandHint[];
  onClose: () => void;
  onSelect: (hint: TerminalCommandHint) => void;
}) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuRef, requestClose, triggerRef]);

  return (
    <div
      ref={menuRef}
      className={`context-menu agent-view__response-skill-menu overlay-popup ${animationClass}`}
      role='menu'
    >
      {items.length === 0 ? (
        <div className='context-menu__submenu-state'>Nenhuma skill disponível</div>
      ) : (
        items.map((hint) => (
          <button
            key={hint.id}
            type='button'
            className='context-menu__item app-button'
            onClick={() => onSelect(hint)}
          >
            <BookOpen size={14} strokeWidth={2} aria-hidden='true' />
            <span className='agent-view__composer-plus-item-label'>{shortenSkillLabel(hint.label)}</span>
          </button>
        ))
      )}
    </div>
  );
}

function AgentProjectSkillPillsComponent({
  projectId,
  projectPath,
  paneId,
  responseContent = '',
  alwaysVisible = false,
}: AgentProjectSkillPillsProps) {
  const updateProject = useProjectStore((state) => state.updateProject);
  const configuredSkills = useProjectStore(
    (state) => state.projects.find((project) => project.id === projectId)?.agentResponseSkills ?? [],
  );
  const [skillHints, setSkillHints] = useState<TerminalCommandHint[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [runningSkillId, setRunningSkillId] = useState<string | null>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    void window.nexus.files.getAgentSkillHints(projectPath).then((entries) => {
      if (cancelled) {
        return;
      }

      setSkillHints(entries.filter((entry) => entry.hintKind === 'skill'));
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const availableSkillHints = useMemo(() => {
    const configuredIds = new Set(configuredSkills.map((skill) => skill.hintId));

    return skillHints.filter((hint) => !configuredIds.has(hint.id));
  }, [configuredSkills, skillHints]);

  const canAddSkill = configuredSkills.length < MAX_PROJECT_AGENT_RESPONSE_SKILLS;
  const hasSkills = configuredSkills.length > 0 || canAddSkill;

  const handleOpenMenu = useCallback(() => {
    if (!canAddSkill) {
      return;
    }

    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    const rect = addTriggerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setAnchorRect(rect);
    setMenuOpen(true);
  }, [canAddSkill, menuOpen]);

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const handleAddSkill = useCallback(
    (hint: TerminalCommandHint) => {
      if (!canAddSkill || configuredSkills.some((skill) => skill.hintId === hint.id)) {
        handleCloseMenu();
        return;
      }

      const nextSkill: ProjectAgentResponseSkill = {
        id: crypto.randomUUID(),
        hintId: hint.id,
        label: shortenSkillLabel(hint.label),
        command: hint.command,
      };

      void updateProject(projectId, {
        agentResponseSkills: [...configuredSkills, nextSkill],
      });
      handleCloseMenu();
    },
    [canAddSkill, configuredSkills, handleCloseMenu, projectId, updateProject],
  );

  const handleRemoveSkill = useCallback(
    (skillId: string) => {
      void updateProject(projectId, {
        agentResponseSkills: configuredSkills.filter((skill) => skill.id !== skillId),
      });
    },
    [configuredSkills, projectId, updateProject],
  );

  const handleRunSkill = useCallback(
    async (skill: ProjectAgentResponseSkill) => {
      if (runningSkillId) {
        return;
      }

      const skillCommand = skill.command.trim().replace(/\n$/, '');
      const prompt = buildAgentSkillPrompt(skillCommand, responseContent);

      setRunningSkillId(skill.id);

      try {
        const submitted = await submitAgentPanePrompt(paneId, prompt, {
          displayContent: skillCommand,
          skillLabel: skill.label,
          forceNewTurn: true,
        });

        if (!submitted) {
          return;
        }
      } finally {
        setRunningSkillId(null);
      }
    },
    [paneId, responseContent, runningSkillId],
  );

  if (!hasSkills) {
    return null;
  }

  return (
    <div
      className={`agent-view__response-actions-skills${alwaysVisible ? ' agent-view__response-actions-skills--always-visible' : ''}`}
    >
      {configuredSkills.map((skill) => {
        const isRunning = runningSkillId === skill.id;

        return (
          <div key={skill.id} className='agent-view__response-skill-wrap'>
            <button
              type='button'
              className={`agent-view__response-pill agent-view__response-pill--skill app-button app-button--enter${isRunning ? ' agent-view__response-pill--running' : ''}`}
              aria-label={`Executar skill ${skill.label}`}
              disabled={Boolean(runningSkillId)}
              onClick={() => void handleRunSkill(skill)}
            >
              <BookOpen size={12} strokeWidth={2} aria-hidden='true' />
              <span className='agent-view__response-pill-label'>{skill.label}</span>
            </button>
            <button
              type='button'
              className='agent-view__response-skill-remove app-button app-button--enter'
              aria-label={`Remover skill ${skill.label}`}
              onClick={() => handleRemoveSkill(skill.id)}
            >
              <X size={10} strokeWidth={2} aria-hidden='true' />
            </button>
          </div>
        );
      })}
      {canAddSkill ? (
        <>
          <button
            ref={addTriggerRef}
            type='button'
            className={`agent-view__response-pill agent-view__response-pill--add app-button app-button--enter${menuOpen ? ' agent-view__response-pill--open' : ''}`}
            aria-label='Adicionar skill'
            aria-haspopup='menu'
            aria-expanded={menuOpen}
            onClick={handleOpenMenu}
          >
            <Plus size={12} strokeWidth={2} aria-hidden='true' />
            <span className='agent-view__response-pill-label'>Skill</span>
          </button>
          {menuOpen && anchorRect
            ? createPortal(
                <AgentProjectSkillPickerMenu
                  anchorRect={anchorRect}
                  triggerRef={addTriggerRef}
                  items={availableSkillHints}
                  onClose={handleCloseMenu}
                  onSelect={handleAddSkill}
                />,
                document.body,
              )
            : null}
        </>
      ) : null}
    </div>
  );
}

export const AgentProjectSkillPills = memo(AgentProjectSkillPillsComponent);
