import { useEffect } from 'react';
import { isDeviceOnline } from '@nexus/supabase';
import { bridge, supabase } from './lib/supabase';
import { useWebStore } from './store';
import { AuthView } from './views/AuthView';
import { WebMaestroHome } from './maestro/WebMaestroHome';
import { registerWebPushServiceWorker } from './maestro/webPush';

export function App() {
  const session = useWebStore((state) => state.session);
  const setSession = useWebStore((state) => state.setSession);
  const setDevices = useWebStore((state) => state.setDevices);
  const setWorkspaces = useWebStore((state) => state.setWorkspaces);
  const setProjects = useWebStore((state) => state.setProjects);
  const setApprovals = useWebStore((state) => state.setApprovals);
  const setSelectedDeviceId = useWebStore((state) => state.setSelectedDeviceId);
  const setSelectedProjectId = useWebStore((state) => state.setSelectedProjectId);
  const setActiveWorkspaceId = useWebStore((state) => state.setActiveWorkspaceId);

  const refresh = async () => {
    const [deviceList, workspaceList, projectList, approvalList] = await Promise.all([
      bridge.listDevices(),
      bridge.listWorkspaces(),
      bridge.listProjects(),
      bridge.listApprovals(),
    ]);
    setDevices(deviceList);
    setWorkspaces(workspaceList);
    setProjects(projectList);
    setApprovals(approvalList);

    const {
      selectedDeviceId: currentDeviceId,
      selectedProjectId: currentProjectId,
      activeWorkspaceId: currentWorkspaceId,
    } = useWebStore.getState();

    const resolvedDeviceId =
      currentDeviceId && deviceList.some((item) => item.id === currentDeviceId)
        ? currentDeviceId
        : (
            deviceList.find((device) => device.is_default && isDeviceOnline(device.last_seen_at)) ??
            deviceList.find((device) => isDeviceOnline(device.last_seen_at)) ??
            deviceList[0]
          )?.id ??
          null;

    const resolvedProjectId =
      currentProjectId && projectList.some((item) => item.id === currentProjectId)
        ? currentProjectId
        : (projectList[0]?.id ?? null);

    if (resolvedDeviceId && resolvedDeviceId !== currentDeviceId) {
      setSelectedDeviceId(resolvedDeviceId);
    }

    if (resolvedProjectId !== currentProjectId) {
      setSelectedProjectId(resolvedProjectId);
    }

    const preferredWorkspaceId =
      projectList.find((item) => item.id === resolvedProjectId)?.workspace_id ??
      deviceList.find((item) => item.id === resolvedDeviceId)?.workspace_id ??
      workspaceList[0]?.id ??
      null;

    if (preferredWorkspaceId && preferredWorkspaceId !== currentWorkspaceId) {
      setActiveWorkspaceId(preferredWorkspaceId);
    }
  };

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [setSession]);

  useEffect(() => {
    if (!session) {
      return;
    }
    void refresh();
    void registerWebPushServiceWorker();
    const timer = window.setInterval(() => {
      void refresh();
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [session]);

  if (!session) {
    return <AuthView />;
  }

  return <WebMaestroHome />;
}
