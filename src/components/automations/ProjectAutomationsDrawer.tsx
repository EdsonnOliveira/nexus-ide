import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AutomationEditorModal } from '@/components/automations/AutomationEditorModal';
import { AutomationListView } from '@/components/automations/AutomationListView';
import { usePendingAutomationCreateStore } from '@/stores/usePendingAutomationCreateStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Automation } from '@/types/automation';
import { createDefaultAutomation } from '@/utils/createDefaultAutomation';
import { executeAutomation } from '@/utils/executeAutomation';
import { normalizeAutomation } from '@/utils/normalizeAutomation';
import { serializeAutomationPrompt } from '@/utils/automationPrompt';

interface ProjectAutomationsDrawerProps {
  projectId: string;
}

function cloneAutomation(automation: Automation): Automation {
  return {
    ...automation,
    steps: automation.steps.map((step) => ({ ...step })),
  };
}

function ProjectAutomationsDrawerComponent({ projectId }: ProjectAutomationsDrawerProps) {
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId) ?? null);
  const updateProject = useProjectStore((state) => state.updateProject);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [draft, setDraft] = useState<Automation>(() => createDefaultAutomation());
  const [editingId, setEditingId] = useState<string | null>(null);
  const pendingCreateProjectId = usePendingAutomationCreateStore((state) => state.pendingProjectId);
  const clearPendingCreate = usePendingAutomationCreateStore((state) => state.clearPending);

  const automations = useMemo(() => project?.automations ?? [], [project?.automations]);

  useEffect(() => {
    if (!pendingCreateProjectId || pendingCreateProjectId !== projectId) {
      return;
    }

    const next = createDefaultAutomation();
    setDraft(next);
    setEditingId(null);
    setView('editor');
    clearPendingCreate();
  }, [clearPendingCreate, pendingCreateProjectId, projectId]);

  const persistAutomations = useCallback(
    async (nextAutomations: Automation[]) => {
      if (!project) {
        return;
      }

      await updateProject(project.id, { automations: nextAutomations });
    },
    [project, updateProject],
  );

  const handleCreate = useCallback(() => {
    const next = createDefaultAutomation();
    setDraft(next);
    setEditingId(null);
    setView('editor');
  }, []);

  const handleEdit = useCallback((automation: Automation) => {
    setDraft(cloneAutomation(normalizeAutomation(automation)));
    setEditingId(automation.id);
    setView('editor');
  }, []);

  const handleBack = useCallback(() => {
    setView('list');
    setEditingId(null);
  }, []);

  const validateDraft = useCallback((): boolean => {
    if (!draft.name.trim()) {
      return false;
    }

    if (draft.steps.length === 0) {
      return false;
    }

    if (draft.trigger === 'interval' && (draft.intervalMinutes ?? 0) < 1) {
      return false;
    }

    return true;
  }, [draft]);

  const handleSave = useCallback(async () => {
    if (!validateDraft()) {
      return;
    }

    const normalized: Automation = normalizeAutomation({
      ...draft,
      name: draft.name.trim(),
      steps: draft.steps.map((step) => ({ ...step, id: step.id || crypto.randomUUID() })),
    });

    if (editingId) {
      await persistAutomations(
        automations.map((automation) => (automation.id === editingId ? normalized : automation)),
      );
    } else {
      await persistAutomations([...automations, { ...normalized, id: crypto.randomUUID() }]);
    }

    setView('list');
    setEditingId(null);
  }, [automations, draft, editingId, persistAutomations, validateDraft]);

  const handleDelete = useCallback(
    async (automation: Automation) => {
      await persistAutomations(automations.filter((item) => item.id !== automation.id));
    },
    [automations, persistAutomations],
  );

  const handleDeleteById = useCallback(
    async (automationId: string) => {
      await persistAutomations(automations.filter((automation) => automation.id !== automationId));
    },
    [automations, persistAutomations],
  );

  const handleCopyPrompt = useCallback((automation: Automation) => {
    void navigator.clipboard.writeText(serializeAutomationPrompt(automation));
  }, []);

  const handleDeleteFromEditor = useCallback(async () => {
    if (!editingId) {
      return;
    }

    await handleDeleteById(editingId);
    handleBack();
  }, [editingId, handleBack, handleDeleteById]);

  const handlePlay = useCallback(
    (automation: Automation) => {
      void executeAutomation(automation, projectId);
    },
    [projectId],
  );

  if (!project) {
    return null;
  }

  return (
    <>
      <AutomationListView
        automations={automations}
        onCreate={handleCreate}
        onEdit={handleEdit}
        onPlay={handlePlay}
        onCopyPrompt={handleCopyPrompt}
        onDelete={(automation) => void handleDelete(automation)}
      />
      {view === 'editor' ? (
        <AutomationEditorModal
          draft={draft}
          isExisting={editingId !== null}
          onChange={setDraft}
          onClose={handleBack}
          onSave={() => void handleSave()}
          onPlay={() => handlePlay({ ...draft, id: editingId ?? draft.id })}
          onDelete={editingId ? () => void handleDeleteFromEditor() : undefined}
        />
      ) : null}
    </>
  );
}

export const ProjectAutomationsDrawer = memo(ProjectAutomationsDrawerComponent);
