import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { downloadImageSrc } from './downloadImageSrc';

export interface WebMarkdownImageLightboxProps {
  src: string;
  fileName?: string | null;
  onClose: () => void;
}

function WebMarkdownImageLightboxComponent({
  src,
  fileName,
  onClose,
}: WebMarkdownImageLightboxProps) {
  const handleDownload = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      downloadImageSrc(src, fileName);
    },
    [fileName, src],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      className='web-modal web-modal--viewport markdown-image-lightbox-overlay app-button--enter'
      role='presentation'
      onClick={onClose}
    >
      <div
        className='markdown-image-lightbox__frame'
        role='dialog'
        aria-modal='true'
        aria-label='Imagem'
        onClick={(event) => event.stopPropagation()}
      >
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
            onClick={onClose}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <img
          src={src}
          alt=''
          className='markdown-image-lightbox__image'
          draggable={false}
        />
      </div>
    </div>,
    document.body,
  );
}

export const WebMarkdownImageLightbox = memo(WebMarkdownImageLightboxComponent);
