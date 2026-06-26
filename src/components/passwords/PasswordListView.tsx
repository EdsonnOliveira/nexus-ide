import { Check, Copy, Lock, Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { PasswordContextMenu } from '@/components/passwords/PasswordContextMenu';
import { EmptyState } from '@/components/overlay/EmptyState';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { usePasswordAutofillStore } from '@/stores/usePasswordAutofillStore';
import { useTabActions } from '@/stores/useTabStore';
import type { PasswordCollection } from '@/types/password';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import {
  formatPasswordCollectionClipboard,
  summarizePasswordCollectionMeta,
} from '@/utils/passwordLabels';

interface PasswordListViewProps {
  projectId: string;
  collections: PasswordCollection[];
  onCreate: () => void;
  onEdit: (collection: PasswordCollection) => void;
  onDelete: (collection: PasswordCollection) => void;
}

interface ContextMenuState {
  collection: PasswordCollection;
  x: number;
  y: number;
}

interface PasswordCopyIconProps {
  copied: boolean;
}

function PasswordCopyIconComponent({ copied }: PasswordCopyIconProps) {
  return (
    <span
      className={`passwords-drawer__action-icon${copied ? ' passwords-drawer__action-icon--copied app-button--enter' : ''}`}
      aria-hidden='true'
    >
      <Copy size={13} strokeWidth={2.25} className='passwords-drawer__action-icon-copy' />
      <Check size={13} strokeWidth={2.25} className='passwords-drawer__action-icon-check' />
    </span>
  );
}

const PasswordCopyIcon = memo(PasswordCopyIconComponent);

const COPY_FEEDBACK_MS = 1500;

function PasswordListViewComponent({
  projectId,
  collections,
  onCreate,
  onEdit,
  onDelete,
}: PasswordListViewProps) {
  const activeCollectionId = usePasswordAutofillStore(
    (state) => state.activeByProject[projectId] ?? null,
  );
  const setActiveCollection = usePasswordAutofillStore((state) => state.setActiveCollection);
  const requestBrowserAutofill = usePasswordAutofillStore((state) => state.requestBrowserAutofill);
  const requestCredentialPicker = usePasswordAutofillStore((state) => state.requestCredentialPicker);
  const { openBrowserTab } = useTabActions();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PasswordCollection | null>(null);
  const [copiedCollectionId, setCopiedCollectionId] = useState<string | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const showCopyFeedback = useCallback((collectionId: string) => {
    setCopiedCollectionId(collectionId);

    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }

    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopiedCollectionId((current) => (current === collectionId ? null : current));
      copyFeedbackTimeoutRef.current = null;
    }, COPY_FEEDBACK_MS);
  }, []);

  const handleRowClick = useCallback(
    (collection: PasswordCollection) => () => {
      onEdit(collection);
    },
    [onEdit],
  );

  const handleCopyClick = useCallback(
    (collection: PasswordCollection) => (event: React.MouseEvent) => {
      event.stopPropagation();
      setActiveCollection(projectId, collection.id);
      requestCredentialPicker(projectId);

      if (collection.browserAutofillEnabled && collection.browserUrl?.trim()) {
        const url = normalizeBrowserUrl(collection.browserUrl.trim());
        requestBrowserAutofill({
          projectId,
          collectionId: collection.id,
          url,
        });
        void openBrowserTab(url);
      }

      void window.nexus.passwords.getValues(projectId, collection.id).then(async (values) => {
        try {
          await navigator.clipboard.writeText(
            formatPasswordCollectionClipboard(collection.fields, values),
          );
          showCopyFeedback(collection.id);
        } catch {
          return;
        }
      });
    },
    [openBrowserTab, projectId, requestBrowserAutofill, requestCredentialPicker, setActiveCollection, showCopyFeedback],
  );

  const handleContextMenu = useCallback(
    (collection: PasswordCollection) => (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        collection,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
  );

  const handleDeleteRequest = useCallback((collection: PasswordCollection) => {
    setDeleteTarget(collection);
  }, []);

  const handleDeleteConfirm = useCallback(
    (requestClose: () => void) => {
      if (!deleteTarget) {
        return;
      }

      onDelete(deleteTarget);
      requestClose();
      setDeleteTarget(null);
    },
    [deleteTarget, onDelete],
  );

  return (
    <aside className='project-explorer-drawer passwords-drawer'>
      <div className='project-explorer__header'>
        <span className='project-explorer__title'>Formulário</span>
        <button
          type='button'
          className='project-explorer__header-btn app-button app-button--enter'
          aria-label='Nova coleção'
          onClick={onCreate}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>
      <div className='passwords-drawer__list'>
        {collections.length === 0 ? (
          <EmptyState
            icon={Lock}
            message='Nenhuma coleção criada'
            compact
            className='passwords-drawer__empty'
          />
        ) : (
          collections.map((collection) => {
            const isActive = activeCollectionId === collection.id;
            const isCopied = copiedCollectionId === collection.id;

            return (
              <div
                key={collection.id}
                className={`passwords-drawer__row app-button--enter${isActive ? ' passwords-drawer__row--active' : ''}`}
                role='button'
                tabIndex={0}
                onClick={handleRowClick(collection)}
                onContextMenu={handleContextMenu(collection)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onEdit(collection);
                  }
                }}
              >
                <div className='passwords-drawer__row-main'>
                  <span className='passwords-drawer__name'>{collection.name}</span>
                  <span className='passwords-drawer__meta'>
                    {summarizePasswordCollectionMeta(collection)}
                  </span>
                </div>
                <div className='passwords-drawer__actions'>
                  <button
                    type='button'
                    className={`passwords-drawer__action passwords-drawer__action--copy app-button app-button--enter${isActive ? ' passwords-drawer__action--active' : ''}${isCopied ? ' passwords-drawer__action--copied' : ''}`}
                    aria-label={
                      isCopied
                        ? `${collection.name} copiada`
                        : isActive
                          ? `Copiar ${collection.name}`
                          : `Copiar e ativar ${collection.name}`
                    }
                    aria-pressed={isActive}
                    onClick={handleCopyClick(collection)}
                  >
                    <PasswordCopyIcon copied={isCopied} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {contextMenu ? (
        <PasswordContextMenu
          collection={contextMenu.collection}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onDelete={handleDeleteRequest}
        />
      ) : null}

      {deleteTarget ? (
        <AnimatedModal onClose={() => setDeleteTarget(null)} panelClassName='project-dialog'>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Excluir coleção</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja excluir <strong>{deleteTarget.name}</strong>?
              </p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--danger app-button'
                  onClick={() => handleDeleteConfirm(requestClose)}
                >
                  Excluir
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
    </aside>
  );
}

export const PasswordListView = memo(PasswordListViewComponent);
