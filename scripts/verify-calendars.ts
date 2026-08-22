/**
 * Verifies both calendar adapters against the live providers.
 *
 * Default: read-only (fetches tomorrow's busy intervals for every professional).
 * With --create: also creates one test event per professional at 20:00 local
 * time (after clinic close, so it never affects availability demos).
 *
 * Usage: npx tsx scripts/verify-calendars.ts [--create]
 */
import 'dotenv/config';
import { DateTime } from 'luxon';
import { buildProfessionalCalendars } from '../src/calendar/registry';
import { loadCalendarConfig, loadConfig } from '../src/config';

async function main(): Promise<void> {
  const config = loadConfig();
  const calendars = buildProfessionalCalendars(loadCalendarConfig());
  const createTestEvents = process.argv.includes('--create');

  const tomorrow = DateTime.now()
    .setZone(config.clinicTimezone)
    .plus({ days: 1 })
    .startOf('day');
  const from = tomorrow.set({ hour: 9 }).toJSDate();
  const to = tomorrow.set({ hour: 18 }).toJSDate();

  let failures = 0;

  for (const [professionalId, calendar] of calendars) {
    try {
      const busy = await calendar.provider.getBusyIntervals({
        calendarId: calendar.calendarId,
        from,
        to,
      });
      console.info(
        `[OK] ${professionalId} (${calendar.professional.calendarProviderId}): ` +
          `${busy.length} busy interval(s) on ${tomorrow.toISODate()}`,
      );
      for (const interval of busy) {
        const start = DateTime.fromJSDate(interval.start).setZone(config.clinicTimezone);
        const end = DateTime.fromJSDate(interval.end).setZone(config.clinicTimezone);
        console.info(`     busy ${start.toFormat('HH:mm')}-${end.toFormat('HH:mm')} (${config.clinicTimezone})`);
      }

      if (createTestEvents) {
        const eventStart = tomorrow.set({ hour: 20 }).toJSDate();
        const eventEnd = tomorrow.set({ hour: 20, minute: 30 }).toJSDate();
        const event = await calendar.provider.createEvent({
          calendarId: calendar.calendarId,
          title: '[Test] adapter verification - safe to delete',
          start: eventStart,
          end: eventEnd,
          description: 'Created by scripts/verify-calendars.ts',
        });
        console.info(`[OK] ${professionalId}: created test event ${event.id}`);
      }
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FAIL] ${professionalId}: ${message}`);
    }
  }

  if (failures > 0) {
    console.error(`${failures} professional(s) failed verification.`);
    process.exit(1);
  }
  console.info('All calendar adapters verified.');
}

void main();
