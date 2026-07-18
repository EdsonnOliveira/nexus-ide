import { memo, useEffect } from 'react';
import { LogOut, Monitor, X } from 'lucide-react';
import { isDeviceOnline } from '@nexus/supabase';
import { sanitizeDeviceName } from '@nexus/protocol';
import { EmptyState } from '@/components/overlay/EmptyState';
import { CloudAuthForm } from '@/components/cloud/CloudAuthForm';
import { useCloudStore } from '@/stores/useCloudStore';

function CloudDevicesDrawerComponent() {
  const open = useCloudStore((state) => state.drawerOpen);
  const setDrawerOpen = useCloudStore((state) => state.setDrawerOpen);
  const authenticated = useCloudStore((state) => state.authenticated);
  const accountEmail = useCloudStore((state) => state.accountEmail);
  const devices = useCloudStore((state) => state.devices);
  const runtimeOnline = useCloudStore((state) => state.runtimeOnline);
  const approvals = useCloudStore((state) => state.approvals);
  const refresh = useCloudStore((state) => state.refresh);
  const decideApproval = useCloudStore((state) => state.decideApproval);
  const signOut = useCloudStore((state) => state.signOut);
  const configured = useCloudStore((state) => state.configured);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  if (!open) {
    return null;
  }

  return (
    <aside className='cloud-devices-drawer app-button--enter'>
      <header className='cloud-devices-drawer__header'>
        <div className='row'>
          <Monitor size={16} />
          <strong>Nexus Cloud</strong>
        </div>
        <button
          type='button'
          className='app-button'
          aria-label='Fechar'
          onClick={() => setDrawerOpen(false)}
        >
          <X size={14} />
        </button>
      </header>
      {!configured ? (
        <EmptyState
          icon={Monitor}
          message='Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local'
          compact
        />
      ) : (
        <>
          <div className='cloud-devices-drawer__status'>
            Runtime local:{' '}
            <span className={runtimeOnline ? 'badge' : 'badge badge--danger'}>
              {runtimeOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          {authenticated ? (
            <div className='cloud-devices-drawer__item'>
              <div className='row'>
                <span className='muted'>Conectado como {accountEmail}</span>
              </div>
              <button
                type='button'
                className='app-button app-button--enter'
                onClick={() => void signOut()}
              >
                <LogOut size={14} />
                Sair
              </button>
            </div>
          ) : (
            <CloudAuthForm />
          )}
          <div className='cloud-devices-drawer__list'>
            {devices.length === 0 ? (
              <EmptyState
                icon={Monitor}
                message={
                  authenticated
                    ? 'Nenhum Mac cadastrado. Inicie o Runtime em um Mac para conectar.'
                    : 'Nenhum Mac cadastrado. Faça login e inicie o Runtime.'
                }
                compact
              />
            ) : (
              devices.map((device) => {
                const online = isDeviceOnline(device.last_seen_at);
                return (
                  <div key={device.id} className='cloud-devices-drawer__item'>
                    <div className='row'>
                      <span className={`dot ${online ? 'dot--online' : 'dot--offline'}`} />
                      <strong>{sanitizeDeviceName(device.name)}</strong>
                    </div>
                    <div className='muted'>
                      {device.hostname} · {online ? 'Online' : 'Offline'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {approvals.length > 0 ? (
            <div className='cloud-devices-drawer__approvals'>
              <h4>Aprovações</h4>
              {approvals.map((approval) => (
                <div key={approval.id} className='cloud-devices-drawer__item'>
                  <div>{approval.reason}</div>
                  <div className='row'>
                    <button
                      type='button'
                      className='app-button app-button--enter'
                      onClick={() => void decideApproval(approval.id, 'approved')}
                    >
                      Permitir
                    </button>
                    <button
                      type='button'
                      className='app-button'
                      onClick={() => void decideApproval(approval.id, 'denied')}
                    >
                      Negar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}

export const CloudDevicesDrawer = memo(CloudDevicesDrawerComponent);
