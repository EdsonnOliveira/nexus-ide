import { ipcMain } from 'electron';
import {
  listChildDirectories,
  listDirectoryEntries,
  resolveCdPath,
  resolveDirectoryPath,
} from '../services/directoryListing';
import { getAgentFooterHints } from '../services/agentFooterHints';
import { getTerminalHints } from '../services/terminalHints';
import { detectProjectKinds } from '../services/projectKind';
import { readImageAsDataUrl } from '../services/imageLoader';
import { searchProjectTree, type ExplorerSearchOptions } from '../services/explorerSearch';
import { getGitBranch } from '../services/gitBranch';
import { readTextFile, resolveFilePath, writeTextFile } from '../services/fileReader';

export function registerFileHandlers(): void {
  ipcMain.handle('files:readImageAsDataUrl', async (_, filePath: string) =>
    readImageAsDataUrl(filePath),
  );

  ipcMain.handle('files:listChildDirectories', async (_, dirPath: string) =>
    listChildDirectories(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('files:listDirectoryEntries', async (_, dirPath: string) =>
    listDirectoryEntries(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('files:resolveCdPath', async (_, cwd: string, target: string) =>
    resolveCdPath(resolveDirectoryPath(cwd), target),
  );

  ipcMain.handle('files:getTerminalHints', async (_, cwd: string) =>
    getTerminalHints(resolveDirectoryPath(cwd)),
  );

  ipcMain.handle('files:getAgentSkillHints', async (_, cwd: string) =>
    getAgentFooterHints(resolveDirectoryPath(cwd)),
  );

  ipcMain.handle('files:getGitBranch', async (_, dirPath: string) =>
    getGitBranch(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('files:detectProjectKinds', async (_, dirPaths: string[]) =>
    detectProjectKinds(dirPaths.map((dirPath) => resolveDirectoryPath(dirPath))),
  );

  ipcMain.handle('files:readTextFile', async (_, filePath: string) =>
    readTextFile(resolveFilePath(filePath)),
  );

  ipcMain.handle('files:writeTextFile', async (_, filePath: string, content: string) =>
    writeTextFile(resolveFilePath(filePath), content),
  );

  ipcMain.handle(
    'files:searchProjectTree',
    async (_, dirPath: string, query: string, options: ExplorerSearchOptions) =>
      searchProjectTree(resolveDirectoryPath(dirPath), query, options),
  );
}
