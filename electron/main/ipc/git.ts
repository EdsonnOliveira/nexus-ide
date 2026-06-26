import { ipcMain } from 'electron';
import { resolveDirectoryPath } from '../services/directoryListing';
import {
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  discardGitPaths,
  discoverGitRepos,
  getGitDiff,
  getGitFileDiffSides,
  getGitFileDiffImageSides,
  getGitStatus,
  listGitBranches,
  listGitStashes,
  pullGit,
  pushGit,
  setGitWatchWindow,
  stageGitPaths,
  stashGit,
  stashPopGit,
  unstageGitPaths,
  unwatchGitRepo,
  watchGitRepo,
  invalidateGitStatusCache,
} from '../services/git';

export function registerGitHandlers(getWindow: () => Electron.BrowserWindow | null): void {
  setGitWatchWindow(getWindow);

  ipcMain.handle('git:getStatus', async (_, dirPath: string) =>
    getGitStatus(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('git:discoverRepos', async (_, dirPath: string) =>
    discoverGitRepos(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('git:stage', async (_, dirPath: string, paths: string[]) =>
    stageGitPaths(resolveDirectoryPath(dirPath), paths),
  );

  ipcMain.handle('git:unstage', async (_, dirPath: string, paths: string[]) =>
    unstageGitPaths(resolveDirectoryPath(dirPath), paths),
  );

  ipcMain.handle('git:discard', async (_, dirPath: string, paths: string[]) =>
    discardGitPaths(resolveDirectoryPath(dirPath), paths),
  );

  ipcMain.handle('git:commit', async (_, dirPath: string, message: string) =>
    commitGit(resolveDirectoryPath(dirPath), message),
  );

  ipcMain.handle('git:diff', async (_, dirPath: string, filePath: string, staged: boolean) =>
    getGitDiff(resolveDirectoryPath(dirPath), filePath, staged),
  );

  ipcMain.handle(
    'git:getFileDiffSides',
    async (
      _,
      dirPath: string,
      filePath: string,
      options: { staged: boolean; untracked?: boolean },
    ) => getGitFileDiffSides(resolveDirectoryPath(dirPath), filePath, options),
  );

  ipcMain.handle(
    'git:getFileDiffImageSides',
    async (
      _,
      dirPath: string,
      filePath: string,
      options: { staged: boolean; untracked?: boolean },
    ) => getGitFileDiffImageSides(resolveDirectoryPath(dirPath), filePath, options),
  );

  ipcMain.handle('git:pull', async (_, dirPath: string) => pullGit(resolveDirectoryPath(dirPath)));

  ipcMain.handle('git:push', async (_, dirPath: string) => pushGit(resolveDirectoryPath(dirPath)));

  ipcMain.handle('git:listBranches', async (_, dirPath: string) =>
    listGitBranches(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('git:checkout', async (_, dirPath: string, branch: string) =>
    checkoutGitBranch(resolveDirectoryPath(dirPath), branch),
  );

  ipcMain.handle('git:createBranch', async (_, dirPath: string, branch: string) =>
    createGitBranch(resolveDirectoryPath(dirPath), branch),
  );

  ipcMain.handle('git:stash', async (_, dirPath: string, message?: string) =>
    stashGit(resolveDirectoryPath(dirPath), message),
  );

  ipcMain.handle('git:stashPop', async (_, dirPath: string) =>
    stashPopGit(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('git:stashList', async (_, dirPath: string) =>
    listGitStashes(resolveDirectoryPath(dirPath)),
  );

  ipcMain.handle('git:watch', async (_, dirPath: string) => {
    watchGitRepo(resolveDirectoryPath(dirPath));
  });

  ipcMain.handle('git:unwatch', async (_, dirPath: string) => {
    unwatchGitRepo(resolveDirectoryPath(dirPath));
  });

  ipcMain.handle('git:invalidateCache', async (_, dirPath: string) => {
    invalidateGitStatusCache(resolveDirectoryPath(dirPath));
  });
}
