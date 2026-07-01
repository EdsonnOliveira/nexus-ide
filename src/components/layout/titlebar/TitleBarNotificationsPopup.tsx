import { memo, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import { positionDropdownBelowAnchor, useAnchoredDropdownMenu } from '@/hooks/useAnchoredDropdownMenu';
import type { SystemNotificationsSnapshot } from '@/types';
import {
  notificationAppIconKey,
  useNotificationAppIcons,
} from '@/hooks/useNotificationAppIcons';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';
import { formatNotificationRelativeTime } from '@/utils/notificationRelativeTime';

interface TitleBarNotificationsPopupProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  systemNotifications: SystemNotificationsSnapshot;
  loading: boolean;
  onRefresh: () => void;
  onClose: () => void;
}

function TitleBarNotificationsPopupComponent({
  anchorRect,
  anchorRef,
  systemNotifications,
  loading,
  onRefresh,
  onClose,
}: TitleBarNotificationsPopupProps) {
  const projects = useProjectStore((state) => state.projects);
  const selectProject = useProjectStore((state) => state.selectProject);
  const { selectPane } = useTabActions();
  const notifiedAgentPaneByProject = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject,
  );
  const clearProjectNotification = useProjectNotificationStore(
    (state) => state.clearProjectNotification,
  );
  const appIcons = useNotificationAppIcons(systemNotifications.items);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );

  useTitleBarPopupDismiss(menuRef, anchorRef, requestClose);

  const notifiedProjects = useMemo(
    () =>
      projects
        .filter((project) => Boolean(notifiedAgentPaneByProject[project.id]))
        .map((project) => ({
          project,
          paneId: notifiedAgentPaneByProject[project.id],
        })),
    [notifiedAgentPaneByProject, projects],
  );

  const subtitle = useMemo(() => {
    const parts: string[] = [];

    if (notifiedProjects.length > 0) {
      parts.push(`${notifiedProjects.length} agente${notifiedProjects.length > 1 ? 's' : ''}`);
    }

    if (systemNotifications.items.length > 0) {
      parts.push(`${systemNotifications.items.length} do sistema`);
    }

    if (parts.length === 0) {
      return 'Nexus IDE e macOS';
    }

    return parts.join(' · ');
  }, [notifiedProjects.length, systemNotifications.items.length]);

  const isEmpty =
    !loading &&
    notifiedProjects.length === 0 &&
    systemNotifications.items.length === 0;

  const canClearAll =
    !loading &&
    (notifiedProjects.length > 0 ||
      (systemNotifications.accessGranted && systemNotifications.items.length > 0));

  const handleSelectAgentNotification = useCallback(
    (projectId: string, paneId: string) => {
      void selectProject(projectId).then(() => selectPane(paneId));
      requestClose();
    },
    [requestClose, selectPane, selectProject],
  );

  const handleSelectSystemNotification = useCallback((appId: string) => {
    if (appId) {
      void window.nexus.systemNotifications.openApp(appId);
    }
  }, []);

  const handleOpenFullDiskAccessSettings = useCallback(() => {
    void window.nexus.systemNotifications.openFullDiskAccessSettings();
  }, []);

  const handleRevealFullDiskAccessApp = useCallback(() => {
    void window.nexus.systemNotifications.revealFullDiskAccessApp();
  }, []);

  const handleDeleteNotification = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, notificationId: string) => {
      event.preventDefault();
      event.stopPropagation();
      void window.nexus.systemNotifications.delete(notificationId).then(() => {
        onRefresh();
      });
    },
    [onRefresh],
  );

  const handleDismissAgentNotification = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, projectId: string) => {
      event.preventDefault();
      event.stopPropagation();
      clearProjectNotification(projectId);
    },
    [clearProjectNotification],
  );

  const handleDeleteAllNotifications = useCallback(() => {
    const deleteSystemTask =
      systemNotifications.accessGranted && systemNotifications.items.length > 0
        ? window.nexus.systemNotifications.deleteAll(systemNotifications.items.length)
        : Promise.resolve(true);

    void deleteSystemTask.then((deleted) => {
      if (!deleted && systemNotifications.items.length > 0) {
        return;
      }

      notifiedProjects.forEach(({ project }) => {
        clearProjectNotification(project.id);
      });
      onRefresh();
    });
  }, [
    clearProjectNotification,
    notifiedProjects,
    onRefresh,
    systemNotifications.accessGranted,
    systemNotifications.items.length,
  ]);

  const diskAccessMessage = useMemo(() => {
    if (systemNotifications.accessGranted || !systemNotifications.platformSupported) {
      return null;
    }

    const appName = systemNotifications.fullDiskAccessAppName ?? 'Nexus IDE';

    return `Para ver notificações do macOS, ative Acesso Total ao Disco em "${appName}" (Privacidade e Segurança). Use Revelar app no Finder e adicione o helper estável. Reinicie o app após conceder.`;
  }, [
    systemNotifications.accessGranted,
    systemNotifications.fullDiskAccessAppName,
    systemNotifications.platformSupported,
  ]);

  const diskAccessPath = systemNotifications.fullDiskAccessAppPath;

  const popup = createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title='Notificações'
      popoverClassName='titlebar-panel__popover--wide'
      onClose={requestClose}
      actions={
        <>
          <button
            type='button'
            className='agent-cursor-usage__action app-button app-button--enter'
            onClick={() => {
              onRefresh();
            }}
          >
            Atualizar
          </button>
          {canClearAll ? (
            <button
              type='button'
              className='agent-cursor-usage__action titlebar-panel__action--danger app-button app-button--enter'
              onClick={handleDeleteAllNotifications}
            >
              Apagar tudo
            </button>
          ) : null}
        </>
      }
    >
      <p className='agent-cursor-usage__period'>{subtitle}</p>

      {loading ? (
        <p className='agent-cursor-usage__period'>Carregando notificações...</p>
      ) : isEmpty ? (
        <EmptyState
          icon={Bell}
          title='Nenhuma notificação pendente'
          message={diskAccessMessage ?? undefined}
          compact
          className='titlebar-panel__empty'
        >
          {diskAccessMessage ? (
            <div className='titlebar-panel__empty-actions'>
              {diskAccessPath ? (
                <span className='titlebar-panel__disk-access-path'>{diskAccessPath}</span>
              ) : null}
              <button
                type='button'
                className='agent-cursor-usage__action app-button app-button--enter'
                onClick={handleOpenFullDiskAccessSettings}
              >
                Abrir Ajustes do Sistema
              </button>
              <button
                type='button'
                className='agent-cursor-usage__action app-button app-button--enter'
                onClick={handleRevealFullDiskAccessApp}
              >
                Revelar app no Finder
              </button>
            </div>
          ) : null}
        </EmptyState>
      ) : (
        <div className='titlebar-panel__entries'>
          {notifiedProjects.length > 0 ? (
            <>
              <p className='titlebar-panel__section-label'>Nexus IDE</p>
              {notifiedProjects.map(({ project, paneId }) => (
                <div key={project.id} className='titlebar-panel__entry app-button--enter'>
                  <button
                    type='button'
                    className='titlebar-panel__entry-open'
                    onClick={() => handleSelectAgentNotification(project.id, paneId)}
                  >
                    <span className='agent-cursor-usage__item'>
                      <span className='agent-cursor-usage__item-label'>{project.name}</span>
                      <span className='agent-cursor-usage__item-value'>agora</span>
                    </span>
                    <span className='agent-cursor-usage__period'>Agente pronto</span>
                  </button>
                  <button
                    type='button'
                    className='titlebar-panel__entry-delete app-button app-button--enter'
                    aria-label='Apagar notificação'
                    onClick={(event) => handleDismissAgentNotification(event, project.id)}
                  >
                    <Trash2 size={14} strokeWidth={2} aria-hidden='true' />
                  </button>
                </div>
              ))}
            </>
          ) : null}

          {systemNotifications.items.length > 0 ? (
            <>
              <p className='titlebar-panel__section-label'>Sistema</p>
              {systemNotifications.items.map((notification) => {
                const iconKey = notificationAppIconKey(notification.appId, notification.appLabel);
                const iconUrl = appIcons[iconKey];

                return (
                  <div key={notification.id} className='titlebar-panel__entry app-button--enter'>
                    <button
                      type='button'
                      className='titlebar-panel__entry-open'
                      onClick={() => handleSelectSystemNotification(notification.appId)}
                    >
                      <div className='titlebar-panel__entry-main'>
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt=''
                            className='titlebar-panel__entry-icon'
                          />
                        ) : (
                          <span
                            className='titlebar-panel__entry-icon titlebar-panel__entry-icon--fallback'
                            aria-hidden='true'
                          >
                            {notification.appLabel.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div className='titlebar-panel__entry-content'>
                          <span className='titlebar-panel__entry-title'>{notification.title}</span>
                          <span className='agent-cursor-usage__period'>
                            {formatNotificationRelativeTime(notification.deliveredAt)}
                          </span>
                          {notification.body ? (
                            <span className='titlebar-panel__entry-body'>{notification.body}</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                    <button
                      type='button'
                      className='titlebar-panel__entry-delete app-button app-button--enter'
                      aria-label='Apagar notificação'
                      onClick={(event) => handleDeleteNotification(event, notification.id)}
                    >
                      <Trash2 size={14} strokeWidth={2} aria-hidden='true' />
                    </button>
                  </div>
                );
              })}
            </>
          ) : null}
        </div>
      )}

      {!isEmpty && diskAccessMessage ? (
        <p className='agent-cursor-usage__period'>{diskAccessMessage}</p>
      ) : null}
    </TitleBarPopupShell>,
    document.body,
  );

  return popup;
}

export const TitleBarNotificationsPopup = memo(TitleBarNotificationsPopupComponent);
