import { memo, useMemo } from 'react';
import { MaterialExplorerIcon } from '@/components/explorer/MaterialExplorerIcon';
import {
  resolveMaterialFileIconKey,
  resolveMaterialFolderIconKey,
} from '@/utils/materialExplorerIcons';

function ExplorerDirectoryIconComponent({
  folderName,
  expanded = false,
}: {
  folderName: string;
  expanded?: boolean;
}) {
  const iconKey = useMemo(
    () => resolveMaterialFolderIconKey(folderName, expanded),
    [expanded, folderName],
  );

  return <MaterialExplorerIcon iconKey={iconKey} />;
}

function ExplorerFileIconComponent({ name }: { name: string }) {
  const iconKey = useMemo(() => resolveMaterialFileIconKey(name), [name]);

  return <MaterialExplorerIcon iconKey={iconKey} />;
}

export const ExplorerDirectoryIcon = memo(ExplorerDirectoryIconComponent);
export const ExplorerFileIcon = memo(ExplorerFileIconComponent);
