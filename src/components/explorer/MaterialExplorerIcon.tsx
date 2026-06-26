import { memo, useEffect, useState } from 'react';
import { getCachedMaterialIconUrl, loadMaterialIconUrl } from '@/utils/materialExplorerIcons';

interface MaterialExplorerIconProps {
  iconKey: string;
}

function MaterialExplorerIconComponent({ iconKey }: MaterialExplorerIconProps) {
  const [src, setSrc] = useState<string | null>(() => getCachedMaterialIconUrl(iconKey));

  useEffect(() => {
    if (src) {
      return;
    }

    let cancelled = false;

    void loadMaterialIconUrl(iconKey).then((nextSrc) => {
      if (!cancelled) {
        setSrc(nextSrc);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [iconKey, src]);

  if (!src) {
    return <span className='project-explorer__material-icon project-explorer__material-icon--placeholder' aria-hidden />;
  }

  return (
    <img
      src={src}
      alt=''
      className='project-explorer__material-icon'
      draggable={false}
      loading='lazy'
    />
  );
}

export const MaterialExplorerIcon = memo(MaterialExplorerIconComponent);
