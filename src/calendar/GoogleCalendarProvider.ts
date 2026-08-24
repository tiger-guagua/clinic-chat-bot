import type { BusyInterval } from '../domain/types';
import type { CalendarEvent, CalendarProvider } from './CalendarProvider';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
// A hung provider call must fail closed instead of freezing the chat turn.
const REQUEST_TIMEOUT_MS = 10_000;

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface GoogleFreeBusyResponse {
  calendars?: Record<
    string,
    {
      busy?: Array<{ start: string; end: string }>;
      errors?: Array<{ domain?: string; reason?: string }>;
    }
  >;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
}

interface GoogleEventResponse {
  id: string;
}

function truncate(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

export class GoogleCalendarProvider implements CalendarProvider {
  private cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly credentials: GoogleCredentials,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async getBusyIntervals(input: {
    calendarId: string;
    from: Date;
    to: Date;
  }): Promise<BusyInterval[]> {
    const response = await this.apiFetch<GoogleFreeBusyResponse>(
      `${CALENDAR_API_BASE}/freeBusy`,
      'POST',
      {
        timeMin: input.from.toISOString(),
        timeMax: input.to.toISOString(),
        items: [{ id: input.calendarId }],
      },
    );

    const calendar = response.calendars?.[input.calendarId];
    if (!calendar) {
      throw new Error('Google freeBusy response is missing the requested calendar.');
    }
    if (calendar.errors && calendar.errors.length > 0) {
      throw new Error(
        `Google freeBusy reported calendar errors: ${JSON.stringify(calendar.errors)}`,
      );
    }

    return (calendar.busy ?? []).map((interval) => ({
      start: new Date(interval.start),
      end: new Date(interval.end),
    }));
  }

  async createEvent(input: {
    calendarId: string;
    title: string;
    start: Date;
    end: Date;
    description?: string;
  }): Promise<CalendarEvent> {
    const created = await this.apiFetch<GoogleEventResponse>(
      `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(input.calendarId)}/events`,
      'POST',
      {
        summary: input.title,
        description: input.description,
        start: { dateTime: input.start.toISOString() },
        end: { dateTime: input.end.toISOString() },
      },
    );

    return { id: created.id, title: input.title, start: input.start, end: input.end };
  }

  private async apiFetch<T>(url: string, method: string, body: unknown): Promise<T> {
    const accessToken = await this.getAccessToken();
    const response = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = truncate(await response.text());
      throw new Error(`Google Calendar API ${method} failed (${response.status}): ${detail}`);
    }

    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now) {
      return this.cachedToken.accessToken;
    }

    const response = await this.fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Never include the response body: token endpoint errors can echo credentials.
      throw new Error(`Google token refresh failed with status ${response.status}.`);
    }

    const data = (await response.json()) as GoogleTokenResponse;
    this.cachedToken = {
      accessToken: data.access_token,
      expiresAtMs: now + data.expires_in * 1000,
    };
    return data.access_token;
  }
}
