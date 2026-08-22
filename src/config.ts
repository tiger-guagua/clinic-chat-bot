import { z } from 'zod';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CLINIC_TIMEZONE: z.string().min(1).default('Asia/Taipei'),
  CLINIC_OPEN_HOUR: z
    .string()
    .regex(TIME_PATTERN, 'must be HH:MM in 24-hour format')
    .default('09:00'),
  CLINIC_CLOSE_HOUR: z
    .string()
    .regex(TIME_PATTERN, 'must be HH:MM in 24-hour format')
    .default('18:00'),
  SLOT_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  CLINIC_CLOSED_WEEKDAYS: z.string().default('sunday'),
});

export interface AppConfig {
  port: number;
  clinicTimezone: string;
  clinicOpenHour: string;
  clinicCloseHour: string;
  slotIntervalMinutes: number;
  clinicClosedWeekdays: Weekday[];
}

export class ConfigError extends Error {}

function toMinutesOfDay(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function parseClosedWeekdays(raw: string): Weekday[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    if (!WEEKDAYS.includes(entry as Weekday)) {
      throw new ConfigError(
        `CLINIC_CLOSED_WEEKDAYS contains unknown weekday "${entry}". ` +
          `Allowed values: ${WEEKDAYS.join(', ')}`,
      );
    }
  }

  return entries as Weekday[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }

  const raw = parsed.data;

  if (!isValidTimezone(raw.CLINIC_TIMEZONE)) {
    throw new ConfigError(
      `CLINIC_TIMEZONE is not a valid IANA timezone: "${raw.CLINIC_TIMEZONE}"`,
    );
  }

  if (toMinutesOfDay(raw.CLINIC_OPEN_HOUR) >= toMinutesOfDay(raw.CLINIC_CLOSE_HOUR)) {
    throw new ConfigError(
      `CLINIC_OPEN_HOUR (${raw.CLINIC_OPEN_HOUR}) must be earlier than ` +
        `CLINIC_CLOSE_HOUR (${raw.CLINIC_CLOSE_HOUR})`,
    );
  }

  return {
    port: raw.PORT,
    clinicTimezone: raw.CLINIC_TIMEZONE,
    clinicOpenHour: raw.CLINIC_OPEN_HOUR,
    clinicCloseHour: raw.CLINIC_CLOSE_HOUR,
    slotIntervalMinutes: raw.SLOT_INTERVAL_MINUTES,
    clinicClosedWeekdays: parseClosedWeekdays(raw.CLINIC_CLOSED_WEEKDAYS),
  };
}
