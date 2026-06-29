import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PendingPasswordBrowserFill {
  projectId: string;
  collectionId: string;
  url: string;
  requestedAt: number;
}

interface PasswordAutofillState {
  activeByProject: Record<string, string | null>;
  pendingBrowserFill: PendingPasswordBrowserFill | null;
  credentialPickerRequestByProject: Record<string, number>;
  credentialPickerArmedByProject: Record<string, boolean>;
  setActiveCollection: (projectId: string, collectionId: string | null) => void;
  getActiveCollectionId: (projectId: string) => string | null;
  isCredentialPickerArmed: (projectId: string) => boolean;
  requestBrowserAutofill: (payload: {
    projectId: string;
    collectionId: string;
    url: string;
  }) => void;
  clearPendingBrowserAutofill: () => void;
  requestCredentialPicker: (projectId: string) => void;
  dismissCredentialPicker: (projectId: string) => void;
  clearCredentialPickerRequest: (projectId: string) => void;
}

export const usePasswordAutofillStore = create<PasswordAutofillState>()(
  persist(
    (set, get) => ({
      activeByProject: {},
      pendingBrowserFill: null,
      credentialPickerRequestByProject: {},
      credentialPickerArmedByProject: {},
      setActiveCollection: (projectId, collectionId) => {
        set((state) => ({
          activeByProject: {
            ...state.activeByProject,
            [projectId]: collectionId,
          },
        }));
      },
      getActiveCollectionId: (projectId) => get().activeByProject[projectId] ?? null,
      isCredentialPickerArmed: (projectId) => get().credentialPickerArmedByProject[projectId] === true,
      requestBrowserAutofill: ({ projectId, collectionId, url }) => {
        set({
          pendingBrowserFill: {
            projectId,
            collectionId,
            url,
            requestedAt: Date.now(),
          },
        });
      },
      clearPendingBrowserAutofill: () => {
        set({ pendingBrowserFill: null });
      },
      requestCredentialPicker: (projectId) => {
        set((state) => ({
          credentialPickerRequestByProject: {
            ...state.credentialPickerRequestByProject,
            [projectId]: Date.now(),
          },
          credentialPickerArmedByProject: {
            ...state.credentialPickerArmedByProject,
            [projectId]: true,
          },
        }));
      },
      dismissCredentialPicker: (projectId) => {
        set((state) => ({
          credentialPickerArmedByProject: {
            ...state.credentialPickerArmedByProject,
            [projectId]: false,
          },
        }));
      },
      clearCredentialPickerRequest: (projectId) => {
        set((state) => {
          const next = { ...state.credentialPickerRequestByProject };
          delete next[projectId];
          return { credentialPickerRequestByProject: next };
        });
      },
    }),
    {
      name: 'nexus-password-autofill',
      partialize: (state) => ({
        activeByProject: state.activeByProject,
      }),
    },
  ),
);
