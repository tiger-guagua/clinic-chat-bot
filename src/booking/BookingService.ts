import { DateTime } from 'luxon';
import { z } from 'zod';
import type { AppConfig, Weekday } from '../config';
import type { CalendarEvent, CalendarProvider } from '../calendar/CalendarProvider';
import { getEligibleProfessionals, getProfessional, getService, isEligible } from '../domain/catalog';
import type {
  BusyInterval,
  Professional,
  ProfessionalId,
  ServiceId,
  Slot,
} from '../domain/types';
import { calculateFreeStarts, isSlotFree } from './SlotCalculator';

const MS_PER_MINUTE = 60_000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Luxon weekday: 1 = Monday ... 7 = Sunday.
const LUXON_WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export type BookingErrorCode =
  | 'INVALID_SERVICE'
  | 'INVALID_PROFESSIONAL'
  | 'PROFESSIONAL_NOT_ELIGIBLE'
  | 'INVALID_DATE'
  | 'INVALID_START_TIME'
  | 'CLINIC_CLOSED'
  | 'OUTSIDE_CLINIC_HOURS'
  | 'NOT_CONFIRMED'
  | 'INVALID_PATIENT'
  | 'SLOT_UNAVAILABLE'
  | 'CALENDAR_PROVIDER_ERROR';

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

export interface ProfessionalCalendar {
  professional: Professional;
  provider: CalendarProvider;
  calendarId: string;
}

export type ClinicConfig = Pick<
  AppConfig,
  | 'clinicTimezone'
  | 'clinicOpenHour'
  | 'clinicCloseHour'
  | 'slotIntervalMinutes'
  | 'clinicClosedWeekdays'
>;

export type FindSlotsResult =
  | { kind: 'slots'; date: string; slots: Slot[] }
  | { kind: 'clinicClosed'; date: string; weekday: Weekday };

export interface BookAppointmentInput {
  serviceId: string;
  professionalId: string;
  startTime: string;
  patientName: string;
  patientEmail: string;
  confirmed: boolean;
}

export interface BookingConfirmation {
  eventId: string;
  serviceId: ServiceId;
  serviceName: string;
  professionalId: ProfessionalId;
  professionalName: string;
  start: Date;
  end: Date;
}

const patientSchema = z.object({
  patientName: z.string().trim().min(1, 'patient name is required').max(200),
  patientEmail: z.string().trim().email('patient email is invalid').max(320),
});

export class BookingService {
  constructor(
    private readonly calendars: ReadonlyMap<ProfessionalId, ProfessionalCalendar>,
    private readonly config: ClinicConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findSlots(serviceId: string, date: string): Promise<FindSlotsResult> {
    const service = this.requireService(serviceId);
    const day = this.parseClinicDate(date);

    const weekday = this.weekdayOf(day);
    if (this.config.clinicClosedWeekdays.includes(weekday)) {
      return { kind: 'clinicClosed', date, weekday };
    }

    const { openTime, closeTime } = this.clinicWindow(day);
    const slots: Slot[] = [];

    for (const professional of getEligibleProfessionals(service)) {
      const calendar = this.requireCalendar(professional.id);
      const busyIntervals = await this.fetchBusyIntervals(calendar, openTime, closeTime);

      const freeStarts = calculateFreeStarts({
        openTime,
        closeTime,
        slotIntervalMinutes: this.config.slotIntervalMinutes,
        serviceDurationMinutes: service.durationMinutes,
        busyIntervals,
        earliestStart: this.now(),
      });

      for (const start of freeStarts) {
        slots.push({
          professionalId: professional.id,
          professionalName: professional.displayName,
          start,
          end: new Date(start.getTime() + service.durationMinutes * MS_PER_MINUTE),
        });
      }
    }

    slots.sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() ||
        a.professionalId.localeCompare(b.professionalId),
    );

    return { kind: 'slots', date, slots };
  }

  async bookAppointment(input: BookAppointmentInput): Promise<BookingConfirmation> {
    if (input.confirmed !== true) {
      throw new BookingError(
        'NOT_CONFIRMED',
        'Booking requires explicit user confirmation.',
      );
    }

    const service = this.requireService(input.serviceId);

    const professional = getProfessional(input.professionalId);
    if (!professional) {
      throw new BookingError(
        'INVALID_PROFESSIONAL',
        `Unknown professional "${input.professionalId}".`,
      );
    }

    if (!isEligible(service, professional.id)) {
      throw new BookingError(
        'PROFESSIONAL_NOT_ELIGIBLE',
        `${professional.displayName} cannot perform ${service.name}.`,
      );
    }

    const patientResult = patientSchema.safeParse(input);
    if (!patientResult.success) {
      const issues = patientResult.error.issues.map((issue) => issue.message).join('; ');
      throw new BookingError('INVALID_PATIENT', `Invalid patient details: ${issues}`);
    }
    const patient = patientResult.data;

    const startLocal = this.parseStartTime(input.startTime);
    const start = startLocal.toJSDate();
    const end = new Date(start.getTime() + service.durationMinutes * MS_PER_MINUTE);

    const weekday = this.weekdayOf(startLocal);
    if (this.config.clinicClosedWeekdays.includes(weekday)) {
      throw new BookingError('CLINIC_CLOSED', `The clinic is closed on ${weekday}.`);
    }

    const { openTime, closeTime } = this.clinicWindow(startLocal.startOf('day'));
    if (start.getTime() < openTime.getTime() || end.getTime() > closeTime.getTime()) {
      throw new BookingError(
        'OUTSIDE_CLINIC_HOURS',
        'The appointment does not fit inside clinic opening hours.',
      );
    }

    const intervalMs = this.config.slotIntervalMinutes * MS_PER_MINUTE;
    if ((start.getTime() - openTime.getTime()) % intervalMs !== 0) {
      throw new BookingError(
        'INVALID_START_TIME',
        `The start time must align to the ${this.config.slotIntervalMinutes}-minute booking grid.`,
      );
    }

    if (start.getTime() < this.now().getTime()) {
      throw new BookingError('INVALID_START_TIME', 'The start time is in the past.');
    }

    const calendar = this.requireCalendar(professional.id);

    // Recheck: never create an event from availability shown earlier in the
    // conversation; the calendar must be re-read immediately before creation.
    const busyIntervals = await this.fetchBusyIntervals(calendar, openTime, closeTime);
    if (!isSlotFree(start, end, busyIntervals)) {
      throw new BookingError(
        'SLOT_UNAVAILABLE',
        'That slot is no longer available. Please search for slots again.',
      );
    }

    let event: CalendarEvent;
    try {
      event = await calendar.provider.createEvent({
        calendarId: calendar.calendarId,
        title: `[Booking] ${service.name} - ${patient.patientName}`,
        start,
        end,
        description: `Patient email: ${patient.patientEmail}\nBooked via the clinic assistant.`,
      });
    } catch (error) {
      this.logProviderFailure('createEvent', professional.id, error);
      throw new BookingError(
        'CALENDAR_PROVIDER_ERROR',
        'The calendar service failed while creating the appointment. The booking was NOT confirmed.',
      );
    }

    return {
      eventId: event.id,
      serviceId: service.id,
      serviceName: service.name,
      professionalId: professional.id,
      professionalName: professional.displayName,
      start,
      end,
    };
  }

  private requireService(serviceId: string) {
    const service = getService(serviceId);
    if (!service) {
      throw new BookingError('INVALID_SERVICE', `Unknown service "${serviceId}".`);
    }
    return service;
  }

  private requireCalendar(professionalId: ProfessionalId): ProfessionalCalendar {
    const calendar = this.calendars.get(professionalId);
    if (!calendar) {
      throw new BookingError(
        'CALENDAR_PROVIDER_ERROR',
        `No calendar is configured for professional "${professionalId}".`,
      );
    }
    return calendar;
  }

  private parseClinicDate(date: string): DateTime {
    if (!DATE_PATTERN.test(date)) {
      throw new BookingError('INVALID_DATE', 'The date must use the YYYY-MM-DD format.');
    }
    const day = DateTime.fromISO(date, { zone: this.config.clinicTimezone });
    if (!day.isValid) {
      throw new BookingError('INVALID_DATE', `"${date}" is not a valid calendar date.`);
    }

    const today = DateTime.fromJSDate(this.now())
      .setZone(this.config.clinicTimezone)
      .startOf('day');
    if (day.startOf('day') < today) {
      throw new BookingError('INVALID_DATE', 'The date is in the past.');
    }

    return day.startOf('day');
  }

  private parseStartTime(startTime: string): DateTime {
    const parsed = DateTime.fromISO(startTime, { setZone: true });
    if (!parsed.isValid) {
      throw new BookingError(
        'INVALID_START_TIME',
        'The start time must be a valid ISO-8601 datetime.',
      );
    }
    return parsed.setZone(this.config.clinicTimezone);
  }

  private clinicWindow(dayStart: DateTime): { openTime: Date; closeTime: Date } {
    return {
      openTime: this.atTimeOfDay(dayStart, this.config.clinicOpenHour),
      closeTime: this.atTimeOfDay(dayStart, this.config.clinicCloseHour),
    };
  }

  private atTimeOfDay(dayStart: DateTime, time: string): Date {
    const [hour = 0, minute = 0] = time.split(':').map(Number);
    return dayStart.set({ hour, minute }).toJSDate();
  }

  private weekdayOf(dateTime: DateTime): Weekday {
    return LUXON_WEEKDAYS[dateTime.weekday - 1] ?? 'sunday';
  }

  private async fetchBusyIntervals(
    calendar: ProfessionalCalendar,
    from: Date,
    to: Date,
  ): Promise<BusyInterval[]> {
    try {
      return await calendar.provider.getBusyIntervals({
        calendarId: calendar.calendarId,
        from,
        to,
      });
    } catch (error) {
      this.logProviderFailure('getBusyIntervals', calendar.professional.id, error);
      // Fail closed: without real calendar data, no availability may be claimed.
      throw new BookingError(
        'CALENDAR_PROVIDER_ERROR',
        'The calendar service is unavailable, so availability cannot be verified. Please try again later.',
      );
    }
  }

  private logProviderFailure(
    operation: string,
    professionalId: ProfessionalId,
    error: unknown,
  ): void {
    console.error(
      JSON.stringify({
        event: 'calendar_provider_failure',
        operation,
        professionalId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
