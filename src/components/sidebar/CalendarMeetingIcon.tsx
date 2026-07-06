import { memo } from 'react';
import { Video } from 'lucide-react';
import type { CalendarMeetingProvider } from '@/utils/calendarEventStyle';
import { CALENDAR_MEETING_PROVIDER_ICONS } from '@/utils/calendarMeetingIcons';

interface CalendarMeetingIconProps {
  provider: CalendarMeetingProvider;
  size?: number;
}

function CalendarMeetingIconComponent({ provider, size = 20 }: CalendarMeetingIconProps) {
  const iconSrc = CALENDAR_MEETING_PROVIDER_ICONS[provider];

  if (!iconSrc) {
    return <Video size={size} strokeWidth={2} aria-hidden='true' />;
  }

  return (
    <img
      src={iconSrc}
      alt=''
      width={size}
      height={size}
      className='sidebar-calendar-popup__meeting-icon'
      aria-hidden='true'
      draggable={false}
    />
  );
}

export const CalendarMeetingIcon = memo(CalendarMeetingIconComponent);
