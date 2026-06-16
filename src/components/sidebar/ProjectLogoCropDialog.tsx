import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

const CROP_VIEWPORT = 240;
const LOGO_OUTPUT_SIZE = 128;
const LOGO_DISPLAY_SIZE = 24;
const LOGO_BORDER_RADIUS = 8;
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

interface CropTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ProjectLogoCropDialogProps {
  sourcePath: string;
  projectName: string;
  onConfirm: (dataUrl: string) => void;
  onClose: () => void;
}

function getCoverTransform(imageWidth: number, imageHeight: number): CropTransform {
  const scale = Math.max(CROP_VIEWPORT / imageWidth, CROP_VIEWPORT / imageHeight);
  const scaledWidth = imageWidth * scale;
  const scaledHeight = imageHeight * scale;

  return {
    scale,
    offsetX: (CROP_VIEWPORT - scaledWidth) / 2,
    offsetY: (CROP_VIEWPORT - scaledHeight) / 2,
  };
}

function clampTransform(
  transform: CropTransform,
  imageWidth: number,
  imageHeight: number,
): CropTransform {
  const scaledWidth = imageWidth * transform.scale;
  const scaledHeight = imageHeight * transform.scale;
  const minOffsetX = Math.min(0, CROP_VIEWPORT - scaledWidth);
  const minOffsetY = Math.min(0, CROP_VIEWPORT - scaledHeight);
  const maxOffsetX = Math.max(0, CROP_VIEWPORT - scaledWidth);
  const maxOffsetY = Math.max(0, CROP_VIEWPORT - scaledHeight);

  return {
    scale: transform.scale,
    offsetX: Math.min(maxOffsetX, Math.max(minOffsetX, transform.offsetX)),
    offsetY: Math.min(maxOffsetY, Math.max(minOffsetY, transform.offsetY)),
  };
}

function createCroppedDataUrl(
  image: HTMLImageElement,
  transform: CropTransform,
): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = LOGO_OUTPUT_SIZE;
  canvas.height = LOGO_OUTPUT_SIZE;

  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  const sourceSize = CROP_VIEWPORT / transform.scale;
  const sourceX = -transform.offsetX / transform.scale;
  const sourceY = -transform.offsetY / transform.scale;

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    LOGO_OUTPUT_SIZE,
    LOGO_OUTPUT_SIZE,
  );

  return canvas.toDataURL('image/png');
}

function ProjectLogoCropDialogComponent({
  sourcePath,
  projectName,
  onConfirm,
  onClose,
}: ProjectLogoCropDialogProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [transform, setTransform] = useState<CropTransform | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    scale: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    void window.nexus.files.readImageAsDataUrl(sourcePath).then((dataUrl) => {
      if (cancelled || !dataUrl) {
        return;
      }

      setImageSrc(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [sourcePath]);

  useEffect(() => {
    if (!imageRef.current || !transform) {
      setPreviewSrc(null);
      return;
    }

    const dataUrl = createCroppedDataUrl(imageRef.current, transform);
    setPreviewSrc(dataUrl);
  }, [transform]);

  const handleImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const nextTransform = getCoverTransform(image.naturalWidth, image.naturalHeight);

    imageRef.current = image;
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    setTransform(nextTransform);
  }, []);

  const handleZoomChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!imageSize || !transform) {
        return;
      }

      const nextScale = Number(event.target.value);
      const centerX = CROP_VIEWPORT / 2;
      const centerY = CROP_VIEWPORT / 2;
      const imageCenterX = (centerX - transform.offsetX) / transform.scale;
      const imageCenterY = (centerY - transform.offsetY) / transform.scale;

      setTransform(
        clampTransform(
          {
            scale: nextScale,
            offsetX: centerX - imageCenterX * nextScale,
            offsetY: centerY - imageCenterY * nextScale,
          },
          imageSize.width,
          imageSize.height,
        ),
      );
    },
    [imageSize, transform],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!transform) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY,
        scale: transform.scale,
      };
    },
    [transform],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;

      if (!dragState || dragState.pointerId !== event.pointerId || !imageSize) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;

      setTransform(
        clampTransform(
          {
            scale: dragState.scale,
            offsetX: dragState.offsetX + deltaX,
            offsetY: dragState.offsetY + deltaY,
          },
          imageSize.width,
          imageSize.height,
        ),
      );
    },
    [imageSize],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
    }
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!imageRef.current || !transform || isSaving) {
        return;
      }

      const dataUrl = createCroppedDataUrl(imageRef.current, transform);

      if (!dataUrl) {
        return;
      }

      setIsSaving(true);
      onConfirm(dataUrl);
    },
    [isSaving, onConfirm, transform],
  );

  const zoomValue = transform?.scale ?? MIN_SCALE;
  const zoomMin = useMemo(() => {
    if (!imageSize) {
      return MIN_SCALE;
    }

    return Math.max(MIN_SCALE, Math.min(CROP_VIEWPORT / imageSize.width, CROP_VIEWPORT / imageSize.height));
  }, [imageSize]);

  const previewScale = 3;
  const previewSize = LOGO_DISPLAY_SIZE * previewScale;
  const previewRadius = LOGO_BORDER_RADIUS * previewScale;

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-logo-crop'>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
        <span className='project-dialog__title'>Ajustar logo</span>
        <p className='project-logo-crop__hint'>Arraste e use o zoom para enquadrar como ficará na lista.</p>

        <div
          className='project-logo-crop__viewport'
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {imageSrc ? (
            <img
              ref={imageRef}
              src={imageSrc}
              alt=''
              draggable={false}
              className='project-logo-crop__image'
              style={
                transform
                  ? {
                      width: imageSize ? imageSize.width * transform.scale : undefined,
                      height: imageSize ? imageSize.height * transform.scale : undefined,
                      transform: `translate(${transform.offsetX}px, ${transform.offsetY}px)`,
                    }
                  : undefined
              }
              onLoad={handleImageLoad}
            />
          ) : null}
        </div>

        <label className='project-logo-crop__zoom'>
          <span>Zoom</span>
          <input
            type='range'
            min={zoomMin}
            max={MAX_SCALE}
            step={0.01}
            value={zoomValue}
            onChange={handleZoomChange}
          />
        </label>

        <div className='project-logo-crop__preview-row'>
          <span className='project-logo-crop__preview-label'>Prévia</span>
          <div className='project-logo-crop__preview-item'>
            {previewSrc ? (
              <img
                src={previewSrc}
                alt=''
                className='project-logo-crop__preview-logo'
                style={{ width: previewSize, height: previewSize, borderRadius: previewRadius }}
              />
            ) : (
              <span
                className='project-logo-crop__preview-logo project-logo-crop__preview-logo--empty'
                style={{ width: previewSize, height: previewSize, borderRadius: previewRadius }}
              />
            )}
            <span className='project-logo-crop__preview-name'>{projectName}</span>
          </div>
        </div>

        <div className='project-dialog__actions'>
          <button type='button' className='project-dialog__btn project-dialog__btn--ghost' onClick={requestClose}>
            Cancelar
          </button>
          <button
            type='submit'
            className='project-dialog__btn project-dialog__btn--primary'
            disabled={!transform || !imageSrc || isSaving}
          >
            Salvar
          </button>
        </div>
        </form>
      )}
    </AnimatedModal>
  );
}

export const ProjectLogoCropDialog = memo(ProjectLogoCropDialogComponent);
