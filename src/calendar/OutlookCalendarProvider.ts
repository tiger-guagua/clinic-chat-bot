import type { BusyInterval } from '../domain/types';
import type { CalendarEvent, CalendarProvider } from './CalendarProvider';

// Personal Microsoft accounts authenticate against the "consumers" authority.
const MICROSOFT_TOKEN_URL =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/Calendars.ReadWrite offline_access';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const PAGE_SIZE = 50;
// A hung provider call must fail closed instead of freezing the chat turn.
const REQUEST_TIMEOUT_MS = 10_000;

export interface MicrosoftCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

interface GraphEvent {
  start: GraphDateTime;
  end: GraphDateTime;
  showAs?: string;
}

interface GraphCalendarViewResponse {
  value?: GraphEvent[];
  '@odata.nextLink'?: string;
}

interface GraphEventResponse {
  id: string;
}

interface MicrosoftTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

function truncate(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

// Graph returns 7 fractional-second digits (for example 2026-09-02T02:00:00.0000000),
// which Date.parse does not reliably accept; trim to milliseconds.
function parseGraphDateTime(value: GraphDateTime): Date {
  if (value.timeZone !== 'UTC') {
    throw new Error(`Expected UTC datetimes from Graph, received "${value.timeZone}".`);
  }
  const normalized = value.dateTime.replace(/(\.\d{3})\d*$/, '$1');
  return new Date(`${normalized}Z`);
}

function toGraphDateTime(date: Date): GraphDateTime {
  return { dateTime: date.toISOString().replace(/Z$/, ''), timeZone: 'UTC' };
}

export class OutlookCalendarProvider implements CalendarProvider {
  private cachedToken: { accessToken: string; expiresAtMs: number } | null = null;
  // Microsoft rotates refresh tokens on every use; always keep the newest one.
  private currentRefreshToken: string;

  constructor(
    private readonly credentials: MicrosoftCredentials,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.currentRefreshToken = credentials.refreshToken;
  }

  async getBusyIntervals(input: {
    calendarId: string;
    from: Date;
    to: Date;
  }): Promise<BusyInterval[]> {
    const query = new URLSearchParams({
      startDateTime: input.from.toISOString(),
      endDateTime: input.to.toISOString(),
      $select: 'start,end,showAs',
      $top: String(PAGE_SIZE),
    });

    let url: string | undefined =
      `${GRAPH_BASE}${this.calendarPath(input.calendarId)}/calendarView?${query.toString()}`;
    const busyIntervals: BusyInterval[] = [];

    while (url) {
      const page: GraphCalendarViewResponse =
        await this.apiFetch<GraphCalendarViewResponse>(url, 'GET');
      for (const event of page.value ?? []) {
        if (event.showAs === 'free') {
          continue;
        }
        busyIntervals.push({
          start: parseGraphDateTime(event.start),
          end: parseGraphDateTime(event.end),
        });
      }
      url = page['@odata.nextLink'];
    }

    return busyIntervals;
  }

  async createEvent(input: {
    calendarId: string;
    title: string;
    start: Date;
    end: Date;
    description?: string;
  }): Promise<CalendarEvent> {
    const created = await this.apiFetch<GraphEventResponse>(
      `${GRAPH_BASE}${this.calendarPath(input.calendarId)}/events`,
      'POST',
      {
        subject: input.title,
        body: { contentType: 'text', content: input.description ?? '' },
        start: toGraphDateTime(input.start),
        end: toGraphDateTime(input.end),
        showAs: 'busy',
      },
    );

    return { id: created.id, title: input.title, start: input.start, end: input.end };
  }

  // An empty calendarId means the signed-in account's default calendar.
  private calendarPath(calendarId: string): string {
    return calendarId ? `/me/calendars/${encodeURIComponent(calendarId)}` : '/me/calendar';
  }

  private async apiFetch<T>(url: string, method: string, body?: unknown): Promise<T> {
    const accessToken = await this.getAccessToken();
    const response = await this.fetchFn(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="UTC"',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = truncate(await response.text());
      throw new Error(`Microsoft Graph ${method} failed (${response.status}): ${detail}`);
    }

    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > now) {
      return this.cachedToken.accessToken;
    }

    const response = await this.fetchFn(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.currentRefreshToken,
        grant_type: 'refresh_token',
        scope: GRAPH_SCOPE,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Never include the response body: token endpoint errors can echo credentials.
      throw new Error(`Microsoft token refresh failed with status ${response.status}.`);
    }

    const data = (await response.json()) as MicrosoftTokenResponse;
    this.cachedToken = {
      accessToken: data.access_token,
      expiresAtMs: now + data.expires_in * 1000,
    };
    if (data.refresh_token) {
      this.currentRefreshToken = data.refresh_token;
    }
    return data.access_token;
  }
}
