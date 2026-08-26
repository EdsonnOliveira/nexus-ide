import { useCallback, useRef, useState } from 'react';
import type { AddProjectOptionId } from '@/components/sidebar/AddProjectMenu';
import { useProjectStore } from '@/stores/useProjectStore';

export function useAddProjectFlow() {
  const addProject = useProjectStore((state) => state.addProject);
  const createProject = useProjectStore((state) => state.createProject);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [createPromptOpen, setCreatePromptOpen] = useState(false);

  const handleOpenMenu = useCallback(() => {
    const rect = addButtonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setMenuAnchor(rect);
    setMenuOpen(true);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuAnchor(null);
  }, []);

  const handleSelectOption = useCallback(
    (optionId: AddProjectOptionId) => {
      if (optionId === 'existing') {
        void addProject();
        return;
      }

      setCreatePromptOpen(true);
    },
    [addProject],
  );

  const handleCreateConfirm = useCallback(
    (name: string) => {
      setCreatePromptOpen(false);
      void createProject(name);
    },
    [createProject],
  );

  const handleCreateClose = useCallback(() => {
    setCreatePromptOpen(false);
  }, []);

  return {
    addButtonRef,
    menuOpen,
    menuAnchor,
    createPromptOpen,
    handleOpenMenu,
    handleCloseMenu,
    handleSelectOption,
    handleCreateConfirm,
    handleCreateClose,
  };
}
