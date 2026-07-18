import { bridge } from '../lib/supabase';
import { useWebStore } from '../store';
import { waitForCommandResult } from './webCommandResult';

function triggerBrowserDownload(url: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function downloadWebMobileArtifact(input: {
  artifactPath: string;
  deviceId: string | null;
  projectId: string | null;
  projectName: string | null;
}): Promise<void> {
  const trimmedPath = input.artifactPath.trim();

  if (!trimmedPath) {
    throw new Error('Artefato sem caminho');
  }

  const state = useWebStore.getState();
  const deviceId =
    input.deviceId?.trim() ||
    state.selectedDeviceId ||
    state.devices.find((device) => device.is_default)?.id ||
    state.devices[0]?.id ||
    null;

  if (!deviceId) {
    throw new Error('Nenhum Mac selecionado para baixar o artefato');
  }

  const project =
    (input.projectId ? state.projects.find((item) => item.id === input.projectId) : null) ??
    state.projects.find(
      (item) =>
        (item.local_path && trimmedPath.startsWith(item.local_path)) ||
        (input.projectName && item.name === input.projectName),
    ) ??
    null;

  const workspaceId =
    project?.workspace_id ||
    state.devices.find((device) => device.id === deviceId)?.workspace_id ||
    state.activeWorkspaceId ||
    (await bridge.getWorkspaceId());

  if (!workspaceId) {
    throw new Error('Workspace não encontrado');
  }

  const commandId = await bridge.executeCommand({
    workspace_id: workspaceId,
    project_id: project?.id ?? null,
    target_device_id: deviceId,
    type: 'file_download',
    payload: { path: trimmedPath },
    idempotency_key: crypto.randomUUID(),
  });

  const result = await waitForCommandResult(commandId, 180000);
  const downloadUrl = result.download_url;
  const fileName =
    typeof result.file_name === 'string' && result.file_name.trim()
      ? result.file_name.trim()
      : trimmedPath.split('/').pop() || 'artifact.bin';

  if (typeof downloadUrl !== 'string' || !downloadUrl) {
    throw new Error('URL de download não disponível');
  }

  triggerBrowserDownload(downloadUrl, fileName);
}
