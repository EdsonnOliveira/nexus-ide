import logoGoogleMeet from '@/assets/logo-google-meet.svg';
import logoMicrosoftTeams from '@/assets/logo-microsoft-teams.svg';
import logoWebex from '@/assets/logo-webex.svg';
import logoZoom from '@/assets/logo-zoom.svg';
import type { CalendarMeetingProvider } from '@/utils/calendarEventStyle';

export const CALENDAR_MEETING_PROVIDER_ICONS: Record<CalendarMeetingProvider, string | null> = {
  teams: logoMicrosoftTeams,
  meet: logoGoogleMeet,
  zoom: logoZoom,
  webex: logoWebex,
  generic: null,
};
