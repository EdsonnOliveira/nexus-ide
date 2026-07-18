import { memo, useCallback } from 'react';
import { Download, X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { downloadImageSrc } from '@/utils/downloadImageSrc';

export interface MarkdownImageLightboxProps {
  src: string;
  fileName?: string | null;
  onClose: () => void;
}

function MarkdownImageLightboxComponent({ src, fileName, onClose }: MarkdownImageLightboxProps) {
  const handleDownload = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      downloadImageSrc(src, fileName);
    },
    [fileName, src],
  );

  return (
    <AnimatedModal panelClassName='terminal-paste-image-lightbox markdown-image-lightbox' onClose={onClose}>
      {(requestClose) => (
        <div className='markdown-image-lightbox__frame'>
          <div className='markdown-image-lightbox__toolbar'>
            <button
              type='button'
              className='markdown-image-lightbox__action app-button app-button--enter'
              onClick={handleDownload}
            >
              <Download size={14} strokeWidth={2} />
              <span>Baixar</span>
            </button>
            <button
              type='button'
              className='markdown-image-lightbox__action markdown-image-lightbox__action--icon app-button app-button--enter'
              aria-label='Fechar imagem'
              title='Fechar'
              onClick={requestClose}
            >
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <img
            src={src}
            alt=''
            className='terminal-paste-image-lightbox__image markdown-image-lightbox__image'
            draggable={false}
          />
        </div>
      )}
    </AnimatedModal>
  );
}

export const MarkdownImageLightbox = memo(MarkdownImageLightboxComponent);
