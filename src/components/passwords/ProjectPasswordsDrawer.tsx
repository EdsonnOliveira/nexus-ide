import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  PasswordEditorModal,
  type PasswordDraft,
  type PasswordDraftField,
} from '@/components/passwords/PasswordEditorModal';
import { PasswordListView } from '@/components/passwords/PasswordListView';
import { usePendingPasswordViewStore } from '@/stores/usePendingPasswordViewStore';
import { usePasswordAutofillStore } from '@/stores/usePasswordAutofillStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { PasswordCollection } from '@/types/password';
import { createDefaultPasswordCollection, normalizePasswordFieldAction } from '@/utils/createDefaultPasswordCollection';

interface ProjectPasswordsDrawerProps {
  projectId: string;
}

function toDraft(collection: PasswordCollection, values: Record<string, string>): PasswordDraft {
  return {
    id: collection.id,
    name: collection.name,
    browserAutofillEnabled: collection.browserAutofillEnabled ?? false,
    browserUrl: collection.browserUrl ?? '',
    fields: collection.fields.map((field) => ({
      id: field.id,
      label: field.label,
      value: values[field.id] ?? '',
      action: normalizePasswordFieldAction(field.action),
    })),
  };
}

function toCollection(draft: PasswordDraft): PasswordCollection {
  return {
    id: draft.id,
    name: draft.name.trim(),
    browserAutofillEnabled: draft.browserAutofillEnabled,
    browserUrl: draft.browserAutofillEnabled ? draft.browserUrl.trim() || null : null,
    fields: draft.fields.map((field) => ({
      id: field.id,
      label: field.label.trim(),
      action: normalizePasswordFieldAction(field.action),
    })),
  };
}

function toFieldValues(draft: PasswordDraft): Record<string, string> {
  const values: Record<string, string> = {};

  for (const field of draft.fields) {
    values[field.id] = field.value;
  }

  return values;
}

function createEmptyDraft(): PasswordDraft {
  const collection = createDefaultPasswordCollection();

  return {
    id: collection.id,
    name: collection.name,
    browserAutofillEnabled: false,
    browserUrl: '',
    fields: collection.fields.map((field) => ({
      ...field,
      value: '',
      action: normalizePasswordFieldAction(field.action),
    })),
  };
}

function ProjectPasswordsDrawerComponent({ projectId }: ProjectPasswordsDrawerProps) {
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId) ?? null);
  const updateProject = useProjectStore((state) => state.updateProject);
  const setActiveCollection = usePasswordAutofillStore((state) => state.setActiveCollection);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [draft, setDraft] = useState<PasswordDraft>(() => createEmptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const pendingPasswordView = usePendingPasswordViewStore((state) => state.pending);
  const clearPendingPasswordView = usePendingPasswordViewStore((state) => state.clearPending);

  const collections = useMemo(() => project?.passwordCollections ?? [], [project?.passwordCollections]);

  useEffect(() => {
    if (!pendingPasswordView || pendingPasswordView.projectId !== projectId) {
      return;
    }

    if (pendingPasswordView.createNew) {
      setDraft(createEmptyDraft());
      setEditingId(null);
      setView('editor');
      clearPendingPasswordView();
      return;
    }

    if (!pendingPasswordView.collectionId) {
      clearPendingPasswordView();
      return;
    }

    const collection = collections.find((item) => item.id === pendingPasswordView.collectionId);

    if (!collection) {
      clearPendingPasswordView();
      return;
    }

    void window.nexus.passwords.getValues(projectId, collection.id).then((values) => {
      setDraft(toDraft(collection, values));
      setEditingId(collection.id);
      setView('editor');
      clearPendingPasswordView();
    });
  }, [clearPendingPasswordView, collections, pendingPasswordView, projectId]);

  const persistCollections = useCallback(
    async (nextCollections: PasswordCollection[]) => {
      if (!project) {
        return;
      }

      await updateProject(project.id, { passwordCollections: nextCollections });
    },
    [project, updateProject],
  );

  const handleCreate = useCallback(() => {
    setDraft(createEmptyDraft());
    setEditingId(null);
    setView('editor');
  }, []);

  const handleEdit = useCallback(
    async (collection: PasswordCollection) => {
      const values = await window.nexus.passwords.getValues(projectId, collection.id);
      setDraft(toDraft(collection, values));
      setEditingId(collection.id);
      setView('editor');
    },
    [projectId],
  );

  const handleBack = useCallback(() => {
    setView('list');
    setEditingId(null);
  }, []);

  const validateDraft = useCallback((): boolean => {
    if (!draft.name.trim()) {
      return false;
    }

    if (draft.fields.length === 0) {
      return false;
    }

    if (draft.browserAutofillEnabled && !draft.browserUrl.trim()) {
      return false;
    }

    return draft.fields.every((field) => field.label.trim());
  }, [draft]);

  const handleSave = useCallback(async () => {
    if (!validateDraft()) {
      return;
    }

    const normalizedFields: PasswordDraftField[] = draft.fields.map((field) => ({
      id: field.id || crypto.randomUUID(),
      label: field.label.trim(),
      value: field.value,
      action: normalizePasswordFieldAction(field.action),
    }));
    const normalizedDraft: PasswordDraft = {
      ...draft,
      name: draft.name.trim(),
      fields: normalizedFields,
    };
    const collection = toCollection(normalizedDraft);
    const collectionId = editingId ?? crypto.randomUUID();
    const nextCollection: PasswordCollection = { ...collection, id: collectionId };

    if (editingId) {
      await persistCollections(
        collections.map((item) => (item.id === editingId ? nextCollection : item)),
      );
    } else {
      await persistCollections([...collections, nextCollection]);
    }

    await window.nexus.passwords.saveValues(projectId, collectionId, toFieldValues(normalizedDraft));
    setView('list');
    setEditingId(null);
  }, [collections, draft, editingId, persistCollections, projectId, validateDraft]);

  const handleDelete = useCallback(
    async (collection: PasswordCollection) => {
      await persistCollections(collections.filter((item) => item.id !== collection.id));
      await window.nexus.passwords.deleteValues(projectId, collection.id);

      const activeCollectionId = usePasswordAutofillStore.getState().activeByProject[projectId] ?? null;

      if (activeCollectionId === collection.id) {
        setActiveCollection(projectId, null);
      }
    },
    [collections, persistCollections, projectId, setActiveCollection],
  );

  const handleDeleteFromEditor = useCallback(async () => {
    if (!editingId) {
      return;
    }

    const target = collections.find((collection) => collection.id === editingId);

    if (target) {
      await handleDelete(target);
    }

    handleBack();
  }, [collections, editingId, handleBack, handleDelete]);

  if (!project) {
    return null;
  }

  return (
    <>
      <PasswordListView
        projectId={projectId}
        collections={collections}
        onCreate={handleCreate}
        onEdit={(collection) => void handleEdit(collection)}
        onDelete={(collection) => void handleDelete(collection)}
      />
      {view === 'editor' ? (
        <PasswordEditorModal
          draft={draft}
          isExisting={editingId !== null}
          onChange={setDraft}
          onClose={handleBack}
          onSave={() => void handleSave()}
          onDelete={editingId ? () => void handleDeleteFromEditor() : undefined}
        />
      ) : null}
    </>
  );
}

export const ProjectPasswordsDrawer = memo(ProjectPasswordsDrawerComponent);
