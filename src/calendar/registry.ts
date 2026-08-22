import type { ProfessionalCalendar } from '../booking/BookingService';
import type { CalendarConfig } from '../config';
import { PROFESSIONALS } from '../domain/catalog';
import type { ProfessionalId } from '../domain/types';
import { GoogleCalendarProvider } from './GoogleCalendarProvider';
import { OutlookCalendarProvider } from './OutlookCalendarProvider';

export function buildProfessionalCalendars(
  config: CalendarConfig,
): Map<ProfessionalId, ProfessionalCalendar> {
  const google = new GoogleCalendarProvider({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    refreshToken: config.google.refreshToken,
  });

  const outlook = new OutlookCalendarProvider({
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    refreshToken: config.microsoft.refreshToken,
  });

  return new Map<ProfessionalId, ProfessionalCalendar>([
    [
      'junior',
      {
        professional: PROFESSIONALS.junior,
        provider: google,
        calendarId: config.google.calendarJunior,
      },
    ],
    [
      'senior1',
      {
        professional: PROFESSIONALS.senior1,
        provider: google,
        calendarId: config.google.calendarSenior1,
      },
    ],
    [
      'senior2',
      {
        professional: PROFESSIONALS.senior2,
        provider: outlook,
        calendarId: config.microsoft.calendarSenior2,
      },
    ],
  ]);
}
