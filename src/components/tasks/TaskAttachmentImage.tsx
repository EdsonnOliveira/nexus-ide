import { memo, useEffect } from 'react';
import { useTaskAttachmentSrc } from '@/hooks/useTaskAttachmentSrc';
import type { TaskAttachment } from '@/types/task';
import { resolveTaskAttachmentPreviewKind } from '@/utils/taskLabels';

interface TaskAttachmentImageProps {
  attachment: TaskAttachment;
  className?: string;
  alt?: string;
  onFailed?: () => void;
  onReady?: () => void;
}

interface TaskAttachmentPreviewProps {
  attachment: TaskAttachment;
  className?: string;
  alt?: string;
}

function TaskAttachmentImageComponent({
  attachment,
  className,
  alt,
  onFailed,
  onReady,
}: TaskAttachmentImageProps) {
  const { src, failed, handleImageError } = useTaskAttachmentSrc(attachment);

  useEffect(() => {
    if (failed) {
      onFailed?.();
    }
  }, [failed, onFailed]);

  if (failed || !src) {
    return null;
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt ?? attachment.name}
      onLoad={() => onReady?.()}
      onError={handleImageError}
    />
  );
}

function TaskAttachmentPreviewComponent({
  attachment,
  className,
  alt,
}: TaskAttachmentPreviewProps) {
  const kind = resolveTaskAttachmentPreviewKind(attachment);
  const { src, failed, handleImageError } = useTaskAttachmentSrc(attachment);

  if (kind === 'image') {
    return <TaskAttachmentImage attachment={attachment} className={className} alt={alt} />;
  }

  if (kind === 'audio' && src && !failed) {
    return (
      <audio
        className={className}
        src={src}
        controls
        preload='metadata'
        onError={handleImageError}
      />
    );
  }

  if (kind === 'video' && src && !failed) {
    return (
      <video
        className={className}
        src={src}
        controls
        preload='metadata'
        onError={handleImageError}
      />
    );
  }

  return <span className={className}>{attachment.name}</span>;
}

export const TaskAttachmentImage = memo(TaskAttachmentImageComponent);
export const TaskAttachmentPreview = memo(TaskAttachmentPreviewComponent);
