import { BrowserWindow, ipcMain } from 'electron';
import { exec } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  AgentRole,
  AgentTemplate,
  CreateMissionInput,
  Mission,
  MissionAgentNode,
  MissionEdge,
  MissionFlowTemplate,
  MissionInboxItem,
} from '../../types/mission';
import {
  createMission,
  addMissionAttachment,
  getMission,
  listCustomRoles,
  listCustomTemplates,
  listFlowTemplates,
  listMissions,
  listOpenInboxItems,
  removeFlowTemplate,
  removeMission,
  removeMissionEdge,
  removeMissionNode,
  saveCustomRole,
  saveCustomTemplate,
  saveFlowTemplate,
  updateMission,
  upsertInboxItem,
  upsertMissionEdge,
  upsertMissionNode,
} from '../services/missionStore';
import { saveMissionPendingAttachmentFromDataUrl, writeMissionNoteFile } from '../services/missionAttachments';
import { ensureMissionLiveSkillInProject } from '../services/missionAgentBridge';

const execAsync = promisify(exec);

function broadcastMission(mission: Mission | null): void {
  if (!mission) {
    return;
  }

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mission:updated', mission);
  }
}

function broadcastInbox(): void {
  const items = listOpenInboxItems();

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('mission:inbox', items);
  }
}

export function registerMissionHandlers(): void {
  ipcMain.handle('missions:list', () => listMissions());
  ipcMain.handle('missions:get', (_, id: unknown) =>
    typeof id === 'string' ? getMission(id) : null,
  );

  ipcMain.handle('missions:create', (_, input: unknown) => {
    const payload =
      input && typeof input === 'object' ? (input as CreateMissionInput) : { title: 'Nova missão' };
    const mission = createMission(payload);
    broadcastMission(mission);
    return mission;
  });

  ipcMain.handle('missions:update', (_, id: unknown, patch: Partial<Mission>) => {
    if (typeof id !== 'string') {
      return null;
    }

    const mission = updateMission(id, patch ?? {});
    broadcastMission(mission);
    broadcastInbox();
    return mission;
  });

  ipcMain.handle('missions:remove', (_, id: unknown) => {
    if (typeof id !== 'string') {
      return false;
    }

    const ok = removeMission(id);
    broadcastInbox();
    return ok;
  });

  ipcMain.handle('missions:saveAttachment', async (_, missionId: unknown, sourcePath: unknown) => {
    if (typeof missionId !== 'string' || typeof sourcePath !== 'string' || !sourcePath.trim()) {
      return null;
    }

    const result = await addMissionAttachment(missionId, sourcePath.trim());
    if (!result) {
      return null;
    }

    broadcastMission(result.mission);
    return result.attachment;
  });

  ipcMain.handle(
    'missions:savePendingAttachmentFromDataUrl',
    async (_, dataUrl: unknown, fileName?: unknown) => {
      if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
        return null;
      }

      try {
        return await saveMissionPendingAttachmentFromDataUrl(
          dataUrl.trim(),
          typeof fileName === 'string' ? fileName : undefined,
        );
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle('missions:upsertNode', (_, missionId: unknown, node: MissionAgentNode) => {
    if (typeof missionId !== 'string' || !node || typeof node !== 'object') {
      return null;
    }

    const mission = upsertMissionNode(missionId, node);
    broadcastMission(mission);
    return mission;
  });

  ipcMain.handle('missions:removeNode', (_, missionId: unknown, nodeId: unknown) => {
    if (typeof missionId !== 'string' || typeof nodeId !== 'string') {
      return null;
    }

    const mission = removeMissionNode(missionId, nodeId);
    broadcastMission(mission);
    return mission;
  });

  ipcMain.handle('missions:upsertEdge', (_, missionId: unknown, edge: MissionEdge) => {
    if (typeof missionId !== 'string' || !edge || typeof edge !== 'object') {
      return null;
    }

    const mission = upsertMissionEdge(missionId, edge);
    broadcastMission(mission);
    return mission;
  });

  ipcMain.handle('missions:removeEdge', (_, missionId: unknown, edgeId: unknown) => {
    if (typeof missionId !== 'string' || typeof edgeId !== 'string') {
      return null;
    }

    const mission = removeMissionEdge(missionId, edgeId);
    broadcastMission(mission);
    return mission;
  });

  ipcMain.handle('missions:upsertInboxItem', (_, missionId: unknown, item: MissionInboxItem) => {
    if (typeof missionId !== 'string' || !item || typeof item !== 'object') {
      return null;
    }

    const mission = upsertInboxItem(missionId, item);
    broadcastMission(mission);
    broadcastInbox();
    return mission;
  });

  ipcMain.handle('missions:listInbox', () => listOpenInboxItems());
  ipcMain.handle('missions:listCustomRoles', () => listCustomRoles());
  ipcMain.handle('missions:listCustomTemplates', () => listCustomTemplates());

  ipcMain.handle('missions:saveCustomRole', (_, role: AgentRole) => {
    if (!role || typeof role !== 'object') {
      return null;
    }

    return saveCustomRole(role);
  });

  ipcMain.handle('missions:saveCustomTemplate', (_, template: AgentTemplate) => {
    if (!template || typeof template !== 'object') {
      return null;
    }

    return saveCustomTemplate(template);
  });

  ipcMain.handle('missions:listFlowTemplates', () => listFlowTemplates());

  ipcMain.handle('missions:saveFlowTemplate', (_, template: MissionFlowTemplate) => {
    if (!template || typeof template !== 'object') {
      return null;
    }

    return saveFlowTemplate(template);
  });

  ipcMain.handle('missions:removeFlowTemplate', (_, id: unknown) => {
    if (typeof id !== 'string') {
      return false;
    }

    return removeFlowTemplate(id);
  });

  ipcMain.handle(
    'missions:runShell',
    async (
      _,
      payload: unknown,
    ): Promise<{
      ok: boolean;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      error?: string;
    }> => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false, stdout: '', stderr: '', exitCode: null, error: 'Payload inválido.' };
      }

      const command =
        'command' in payload ? String((payload as { command?: unknown }).command ?? '') : '';
      const cwd = 'cwd' in payload ? String((payload as { cwd?: unknown }).cwd ?? '') : '';

      if (!command.trim() || !cwd.trim()) {
        return {
          ok: false,
          stdout: '',
          stderr: '',
          exitCode: null,
          error: 'Comando e diretório são obrigatórios.',
        };
      }

      let resolvedCwd: string;

      try {
        resolvedCwd = path.resolve(cwd);
        if (!existsSync(resolvedCwd) || !statSync(resolvedCwd).isDirectory()) {
          return {
            ok: false,
            stdout: '',
            stderr: '',
            exitCode: null,
            error: 'Diretório inválido.',
          };
        }
      } catch {
        return {
          ok: false,
          stdout: '',
          stderr: '',
          exitCode: null,
          error: 'Diretório inválido.',
        };
      }

      try {
        const result = await execAsync(command, {
          cwd: resolvedCwd,
          timeout: 120_000,
          maxBuffer: 2 * 1024 * 1024,
          shell: '/bin/zsh',
        });
        return {
          ok: true,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          exitCode: 0,
        };
      } catch (error) {
        const err = error as {
          stdout?: string;
          stderr?: string;
          code?: number;
          message?: string;
        };
        return {
          ok: false,
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? '',
          exitCode: typeof err.code === 'number' ? err.code : null,
          error: err.message ?? 'Falha ao executar comando.',
        };
      }
    },
  );

  ipcMain.handle(
    'missions:writeNoteFile',
    async (_, missionId: unknown, nodeId: unknown, content: unknown) => {
      if (
        typeof missionId !== 'string' ||
        typeof nodeId !== 'string' ||
        typeof content !== 'string'
      ) {
        return { ok: false, error: 'invalid_args' };
      }
      return writeMissionNoteFile(missionId, nodeId, content);
    },
  );

  ipcMain.handle('missions:ensureLiveSkill', (_, projectPath: unknown) => {
    if (typeof projectPath !== 'string' || !projectPath.trim()) {
      return false;
    }
    ensureMissionLiveSkillInProject(projectPath);
    return true;
  });
}
