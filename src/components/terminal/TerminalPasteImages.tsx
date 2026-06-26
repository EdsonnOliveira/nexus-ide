import { memo, useCallback, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { useTerminalPasteImageStore, type TerminalPasteImage } from '@/stores/useTerminalPasteImageStore';
import {
  attachAgentPromptImageToPane,
  readImagePathAsDataUrl,
} from '@/utils/attachAgentPromptImage';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';

interface TerminalPasteImagesProps {
  paneId: string;
  projectPath: string;
  isVisible: boolean;
}

const EMPTY_PASTE_IMAGES: TerminalPasteImage[] = [];

function TerminalPasteImagesComponent({ paneId, projectPath, isVisible }: TerminalPasteImagesProps) {
  const images = useTerminalPasteImageStore((state) => state.imagesByPane[paneId] ?? EMPTY_PASTE_IMAGES);
  const removeImage = useTerminalPasteImageStore((state) => state.removeImage);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const handleOpenImage = useCallback((dataUrl: string) => {
    setExpandedImage(dataUrl);
  }, []);

  const handleCloseImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const handleRemoveImage = useCallback(
    (image: TerminalPasteImage) => {
      getTerminalHandle(paneId)?.removeImageFromPrompt(image.id);
      removeImage(paneId, image.id);

      if (expandedImage === image.dataUrl) {
        setExpandedImage(null);
      }
    },
    [expandedImage, paneId, removeImage],
  );

  const handleAttachImage = useCallback(async () => {
    const sourcePath = await window.nexus.dialog.openImage();

    if (!sourcePath) {
      return;
    }

    const dataUrl = await readImagePathAsDataUrl(sourcePath);

    if (!dataUrl) {
      return;
    }

    await attachAgentPromptImageToPane(projectPath, paneId, dataUrl);
  }, [paneId, projectPath]);

  if (!isVisible) {
    return null;
  }

  return (
    <>
      <div className='terminal-panel__paste-images' role='list' aria-label='Imagens do prompt'>
        <button
          type='button'
          className='terminal-panel__paste-image-attach app-button app-button--enter'
          aria-label='Adicionar imagem'
          onClick={() => void handleAttachImage()}
        >
          <Paperclip size={14} strokeWidth={2} />
        </button>
        {images.map((image) => (
          <div key={image.id} className='terminal-panel__paste-image' role='listitem'>
            <button
              type='button'
              className='terminal-panel__paste-image-remove app-button app-button--enter'
              aria-label={`Remover ${image.label}`}
              onClick={() => handleRemoveImage(image)}
            >
              <X size={12} strokeWidth={2.25} />
            </button>
            <button
              type='button'
              className='terminal-panel__paste-image-open app-button app-button--enter'
              aria-label={`Expandir ${image.label}`}
              title={image.label}
              onClick={() => handleOpenImage(image.dataUrl)}
            >
              <img
                src={image.dataUrl}
                alt={image.label}
                className='terminal-panel__paste-image-thumb'
                draggable={false}
              />
              <span className='terminal-panel__paste-image-label'>{image.label}</span>
            </button>
          </div>
        ))}
      </div>
      {expandedImage ? (
        <AnimatedModal panelClassName='terminal-paste-image-lightbox' onClose={handleCloseImage}>
          {(requestClose) => (
            <button
              type='button'
              className='terminal-paste-image-lightbox__close app-button'
              aria-label='Fechar imagem'
              onClick={requestClose}
            >
              <img
                src={expandedImage}
                alt=''
                className='terminal-paste-image-lightbox__image'
                draggable={false}
              />
            </button>
          )}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const TerminalPasteImages = memo(TerminalPasteImagesComponent);
