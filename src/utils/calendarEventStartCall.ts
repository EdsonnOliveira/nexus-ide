import type { CalendarEventItem } from '@/types';
import { resolveCalendarExternalUrl, resolveCalendarMeetingInfo } from '@/utils/calendarEventStyle';

export async function startCalendarEventCall(event: CalendarEventItem): Promise<void> {
  const meetingInfo = resolveCalendarMeetingInfo(event);
  const meetingUrl = meetingInfo?.url ? resolveCalendarExternalUrl(meetingInfo.url) : null;

  if (meetingUrl && window.nexus?.tasks) {
    void window.nexus.tasks.openExternalUrl(meetingUrl);
  }

  if (!window.nexus?.macParakeet) {
    return;
  }

  await window.nexus.macParakeet.startCallFromEvent(event.title);
}
