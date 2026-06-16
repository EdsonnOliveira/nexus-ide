export interface ExplorerSearchOptions {
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
}

export interface ExplorerSearchNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ExplorerSearchNode[];
}

export const DEFAULT_EXPLORER_SEARCH_OPTIONS: ExplorerSearchOptions = {
  matchCase: false,
  matchWholeWord: false,
  useRegex: false,
};
