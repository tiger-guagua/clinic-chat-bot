import { describe, expect, it } from 'vitest';
import {
  BookingError,
  BookingService,
  type ProfessionalCalendar,
} from '../src/booking/BookingService';
import type { CalendarEvent, CalendarProvider } from '../src/calendar/CalendarProvider';
import { PROFESSIONALS } from '../src/domain/catalog';
import type { BusyInterval, ProfessionalId } from '../src/domain/types';

const DATE = '2026-09-02'; // a Wednesday
const SUNDAY = '2026-09-06';
const NOW = new Date('2026-09-01T08:00:00+08:00');

function at(time: string, date = DATE): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

class FakeCalendarProvider implements CalendarProvider {
  busyIntervals: BusyInterval[] = [];
  failGetBusy = false;
  failCreate = false;
  getBusyCalls: Array<{ calendarId: string; from: Date; to: Date }> = [];
  createdEvents: Array<{ calendarId: string; title: string; start: Date; end: Date }> = [];

  async getBusyIntervals(input: { calendarId: string; from: Date; to: Date }) {
    this.getBusyCalls.push(input);
    if (this.failGetBusy) {
      throw new Error('internal provider stack trace details');
    }
    return this.busyIntervals;
  }

  async createEvent(input: {
    calendarId: string;
    title: string;
    start: Date;
    end: Date;
    description?: string;
  }): Promise<CalendarEvent> {
    if (this.failCreate) {
      throw new Error('internal provider stack trace details');
    }
    this.createdEvents.push(input);
    return {
      id: `evt-${this.createdEvents.length}`,
      title: input.title,
      start: input.start,
      end: input.end,
    };
  }
}

function createHarness() {
  const fakes: Record<ProfessionalId, FakeCalendarProvider> = {
    junior: new FakeCalendarProvider(),
    senior1: new FakeCalendarProvider(),
    senior2: new FakeCalendarProvider(),
  };

  const calendars = new Map<ProfessionalId, ProfessionalCalendar>(
    (Object.keys(fakes) as ProfessionalId[]).map((professionalId) => [
      professionalId,
      {
        professional: PROFESSIONALS[professionalId],
        provider: fakes[professionalId],
        calendarId: `cal-${professionalId}`,
      },
    ]),
  );

  const service = new BookingService(
    calendars,
    {
      clinicTimezone: 'Asia/Taipei',
      clinicOpenHour: '09:00',
      clinicCloseHour: '18:00',
      slotIntervalMinutes: 30,
      clinicClosedWeekdays: ['sunday'],
    },
    () => NOW,
  );

  return { service, fakes };
}

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    serviceId: 'A',
    professionalId: 'junior',
    startTime: `${DATE}T10:00:00+08:00`,
    patientName: 'John Smith',
    patientEmail: 'john@example.com',
    confirmed: true,
    ...overrides,
  };
}

async function expectBookingError(
  promise: Promise<unknown>,
  code: string,
): Promise<BookingError> {
  const error = await promise.then(
    () => {
      throw new Error(`expected BookingError ${code} but the call succeeded`);
    },
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(BookingError);
  expect((error as BookingError).code).toBe(code);
  return error as BookingError;
}

describe('BookingService.findSlots', () => {
  it('never offers junior for service C', async () => {
    const { service } = createHarness();

    const result = await service.findSlots('C', DATE);

    expect(result.kind).toBe('slots');
    if (result.kind === 'slots') {
      const professionals = new Set(result.slots.map((slot) => slot.professionalId));
      expect(professionals).toEqual(new Set(['senior1', 'senior2']));
    }
  });

  it('returns a structured clinic-closed result on a closed weekday', async () => {
    const { service } = createHarness();

    const result = await service.findSlots('A', SUNDAY);

    expect(result).toEqual({ kind: 'clinicClosed', date: SUNDAY, weekday: 'sunday' });
  });

  it('rejects an unknown service', async () => {
    const { service } = createHarness();

    await expectBookingError(service.findSlots('Z', DATE), 'INVALID_SERVICE');
  });

  it('rejects a past date', async () => {
    const { service } = createHarness();

    await expectBookingError(service.findSlots('A', '2026-08-01'), 'INVALID_DATE');
  });

  it('fails the whole lookup when any eligible calendar is unavailable', async () => {
    const { service, fakes } = createHarness();
    fakes.senior2.failGetBusy = true;

    const error = await expectBookingError(
      service.findSlots('C', DATE),
      'CALENDAR_PROVIDER_ERROR',
    );
    expect(error.message).not.toContain('stack trace');
  });
});

describe('BookingService.bookAppointment', () => {
  it('lets junior perform service A', async () => {
    const { service, fakes } = createHarness();

    const confirmation = await service.bookAppointment(baseBooking());

    expect(confirmation.professionalId).toBe('junior');
    expect(confirmation.eventId).toBe('evt-1');
    expect(fakes.junior.createdEvents).toHaveLength(1);
    expect(fakes.junior.createdEvents[0]?.title).toBe('[Booking] Service A - John Smith');
  });

  it('rejects junior for service C', async () => {
    const { service, fakes } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ serviceId: 'C' })),
      'PROFESSIONAL_NOT_ELIGIBLE',
    );
    expect(fakes.junior.getBusyCalls).toHaveLength(0);
    expect(fakes.junior.createdEvents).toHaveLength(0);
  });

  it('lets a senior perform service E', async () => {
    const { service, fakes } = createHarness();

    const confirmation = await service.bookAppointment(
      baseBooking({
        serviceId: 'E',
        professionalId: 'senior1',
        startTime: `${DATE}T09:00:00+08:00`,
      }),
    );

    expect(confirmation.end).toEqual(at('15:00'));
    expect(fakes.senior1.createdEvents).toHaveLength(1);
  });

  it('rejects an unknown service', async () => {
    const { service } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ serviceId: 'Z' })),
      'INVALID_SERVICE',
    );
  });

  it('normalizes model-supplied id casing ("a", "Junior")', async () => {
    const { service, fakes } = createHarness();

    const confirmation = await service.bookAppointment(
      baseBooking({ serviceId: 'a', professionalId: 'Junior' }),
    );

    expect(confirmation.serviceId).toBe('A');
    expect(confirmation.professionalId).toBe('junior');
    expect(fakes.junior.createdEvents).toHaveLength(1);
  });

  it('rejects an unknown professional', async () => {
    const { service } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ professionalId: 'drwho' })),
      'INVALID_PROFESSIONAL',
    );
  });

  it('rechecks the exact slot with the calendar before creating the event', async () => {
    const { service, fakes } = createHarness();

    await service.bookAppointment(baseBooking());

    expect(fakes.junior.getBusyCalls).toHaveLength(1);
    const window = fakes.junior.getBusyCalls[0];
    expect(window?.from).toEqual(at('09:00'));
    expect(window?.to).toEqual(at('18:00'));
  });

  it('returns a conflict when the slot is busy and creates nothing', async () => {
    const { service, fakes } = createHarness();
    fakes.junior.busyIntervals = [{ start: at('10:30'), end: at('11:30') }];

    await expectBookingError(
      service.bookAppointment(baseBooking()),
      'SLOT_UNAVAILABLE',
    );
    expect(fakes.junior.createdEvents).toHaveLength(0);
  });

  it('propagates a calendar failure as a safe application error', async () => {
    const { service, fakes } = createHarness();
    fakes.junior.failCreate = true;

    const error = await expectBookingError(
      service.bookAppointment(baseBooking()),
      'CALENDAR_PROVIDER_ERROR',
    );
    expect(error.message).not.toContain('stack trace');
  });

  it('rejects a booking without explicit confirmation before touching any calendar', async () => {
    const { service, fakes } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ confirmed: false })),
      'NOT_CONFIRMED',
    );
    expect(fakes.junior.getBusyCalls).toHaveLength(0);
    expect(fakes.junior.createdEvents).toHaveLength(0);
  });

  it('rejects an invalid patient email', async () => {
    const { service } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ patientEmail: 'not-an-email' })),
      'INVALID_PATIENT',
    );
  });

  it('rejects a booking on a closed weekday', async () => {
    const { service } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ startTime: `${SUNDAY}T10:00:00+08:00` })),
      'CLINIC_CLOSED',
    );
  });

  it('rejects a slot outside clinic hours', async () => {
    const { service } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ startTime: `${DATE}T17:30:00+08:00` })),
      'OUTSIDE_CLINIC_HOURS',
    );
  });

  it('rejects a start time off the booking grid', async () => {
    const { service } = createHarness();

    await expectBookingError(
      service.bookAppointment(baseBooking({ startTime: `${DATE}T10:15:00+08:00` })),
      'INVALID_START_TIME',
    );
  });

  it('rejects a start time in the past', async () => {
    const { service } = createHarness();

    await expectBookingError(
      service.bookAppointment(
        baseBooking({ startTime: '2026-08-01T10:00:00+08:00' }),
      ),
      'INVALID_START_TIME',
    );
  });
});
