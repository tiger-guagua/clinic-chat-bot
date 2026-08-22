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

const calendarEnvSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REFRESH_TOKEN: z.string().min(1),
  GOOGLE_CALENDAR_JUNIOR: z.string().min(1),
  GOOGLE_CALENDAR_SENIOR1: z.string().min(1),
  MICROSOFT_CLIENT_ID: z.string().min(1),
  MICROSOFT_CLIENT_SECRET: z.string().min(1),
  MICROSOFT_REFRESH_TOKEN: z.string().min(1),
  // Empty means the signed-in Microsoft account's default calendar.
  MICROSOFT_CALENDAR_SENIOR2: z.string().optional().default(''),
});

export interface CalendarConfig {
  google: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarJunior: string;
    calendarSenior1: string;
  };
  microsoft: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarSenior2: string;
  };
}

export function loadCalendarConfig(env: NodeJS.ProcessEnv = process.env): CalendarConfig {
  const parsed = calendarEnvSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.'));
    throw new ConfigError(
      `Missing or invalid calendar configuration: ${missing.join(', ')}\n` +
        'Set these variables in .env. To mint the refresh tokens run:\n' +
        '  npx tsx scripts/get-google-refresh-token.ts\n' +
        '  npx tsx scripts/get-microsoft-refresh-token.ts',
    );
  }

  const raw = parsed.data;
  return {
    google: {
      clientId: raw.GOOGLE_CLIENT_ID,
      clientSecret: raw.GOOGLE_CLIENT_SECRET,
      refreshToken: raw.GOOGLE_REFRESH_TOKEN,
      calendarJunior: raw.GOOGLE_CALENDAR_JUNIOR,
      calendarSenior1: raw.GOOGLE_CALENDAR_SENIOR1,
    },
    microsoft: {
      clientId: raw.MICROSOFT_CLIENT_ID,
      clientSecret: raw.MICROSOFT_CLIENT_SECRET,
      refreshToken: raw.MICROSOFT_REFRESH_TOKEN,
      calendarSenior2: raw.MICROSOFT_CALENDAR_SENIOR2,
    },
  };
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
