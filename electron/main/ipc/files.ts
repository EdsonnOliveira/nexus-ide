import { ipcMain, shell } from 'electron';
import {
  listChildDirectories,
  listDirectoryEntries,
  resolveCdPath,
  resolveDirectoryPath,
} from '../services/directoryListing';
import { getAgentFooterHints } from '../services/agentFooterHints';
import { listCursorAgentHistory, loadCursorAgentSessionTranscript } from '../services/agentHistory';
import { getTerminalHints } from '../services/terminalHints';
import { detectProjectKinds } from '../services/projectKind';
import { readImageAsDataUrl } from '../services/imageLoader';
import { saveTerminalPasteImage } from '../services/terminalPasteImages';
import { searchProjectTree, type ExplorerSearchOptions } from '../services/explorerSearch';
import { createDirectory, createEmptyFile, deleteEntry, importEntries, moveEntry, renameEntry } from '../services/explorerFs';
import { getGitBranch } from '../services/gitBranch';
import { readTextFile, resolveFilePath, writeTextFile } from '../services/fileReader';
import {
  setProjectFileWatchWindow,
  unwatchProjectFiles,
  watchProjectFiles,
} from '../services/projectFileWatcher';

export function registerFileHandlers(getWindow: () => Electron.BrowserWindow | null): void {
  setProjectFileWatchWindow(getWindow);
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

  ipcMain.handle('files:listCursorAgentHistory', async (_, cwd: string) =>
    listCursorAgentHistory(resolveDirectoryPath(cwd)),
  );

  ipcMain.handle('files:loadCursorAgentSessionTranscript', async (_, cwd: string, sessionId: string) =>
    loadCursorAgentSessionTranscript(resolveDirectoryPath(cwd), sessionId),
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

  ipcMain.handle('files:createEmptyFile', async (_, dirPath: string, name: string) =>
    createEmptyFile(resolveDirectoryPath(dirPath), name),
  );

  ipcMain.handle('files:createDirectory', async (_, dirPath: string, name: string) =>
    createDirectory(resolveDirectoryPath(dirPath), name),
  );

  ipcMain.handle('files:moveEntry', async (_, sourcePath: string, destinationDirPath: string) =>
    moveEntry(resolveFilePath(sourcePath), resolveDirectoryPath(destinationDirPath)),
  );

  ipcMain.handle(
    'files:importEntries',
    async (_, destinationDirPath: string, sourcePaths: string[]) =>
      importEntries(
        resolveDirectoryPath(destinationDirPath),
        sourcePaths.map((sourcePath) => resolveFilePath(sourcePath)),
      ),
  );

  ipcMain.handle('files:renameEntry', async (_, entryPath: string, nextName: string) =>
    renameEntry(resolveFilePath(entryPath), nextName),
  );

  ipcMain.handle('files:deleteEntry', async (_, entryPath: string) =>
    deleteEntry(resolveFilePath(entryPath)),
  );

  ipcMain.handle('files:revealInFolder', async (_, entryPath: string) => {
    shell.showItemInFolder(resolveFilePath(entryPath));
  });

  ipcMain.handle('files:watchProject', async (_, dirPath: string) => {
    watchProjectFiles(resolveDirectoryPath(dirPath));
  });

  ipcMain.handle('files:unwatchProject', async (_, dirPath: string) => {
    unwatchProjectFiles(resolveDirectoryPath(dirPath));
  });

  ipcMain.handle(
    'files:saveTerminalPasteImage',
    async (_, projectPath: string, paneId: string, imageIndex: number, dataUrl: string) =>
      saveTerminalPasteImage(
        resolveDirectoryPath(projectPath),
        paneId,
        imageIndex,
        dataUrl,
      ),
  );
}
