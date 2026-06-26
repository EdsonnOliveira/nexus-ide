import { memo, useEffect } from 'react';
import { useTaskAttachmentSrc } from '@/hooks/useTaskAttachmentSrc';
import type { TaskAttachment } from '@/types/task';

interface TaskAttachmentImageProps {
  attachment: TaskAttachment;
  className?: string;
  alt?: string;
  onFailed?: () => void;
  onReady?: () => void;
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

export const TaskAttachmentImage = memo(TaskAttachmentImageComponent);
