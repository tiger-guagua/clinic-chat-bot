import { describe, expect, it } from 'vitest';
import { GoogleCalendarProvider } from '../src/calendar/GoogleCalendarProvider';
import { OutlookCalendarProvider } from '../src/calendar/OutlookCalendarProvider';

const CREDENTIALS = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
};

const TOKEN_BODY = JSON.stringify({
  access_token: 'access-token',
  expires_in: 3600,
});

type RecordedRequest = { url: string; init: RequestInit };

function fakeFetch(
  responder: (url: string, init: RequestInit) => Response,
): { fetchFn: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request = { url, init: init ?? {} };
    requests.push(request);
    return responder(url, request.init);
  }) as typeof fetch;
  return { fetchFn, requests };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GoogleCalendarProvider', () => {
  it('maps freeBusy intervals to Dates', async () => {
    const { fetchFn } = fakeFetch((url) => {
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(TOKEN_BODY, { status: 200 });
      }
      return jsonResponse({
        calendars: {
          'cal-1': {
            busy: [
              { start: '2026-09-02T02:00:00Z', end: '2026-09-02T03:00:00Z' },
            ],
          },
        },
      });
    });

    const provider = new GoogleCalendarProvider(CREDENTIALS, fetchFn);
    const busy = await provider.getBusyIntervals({
      calendarId: 'cal-1',
      from: new Date('2026-09-02T01:00:00Z'),
      to: new Date('2026-09-02T10:00:00Z'),
    });

    expect(busy).toEqual([
      {
        start: new Date('2026-09-02T02:00:00Z'),
        end: new Date('2026-09-02T03:00:00Z'),
      },
    ]);
  });

  it('throws when freeBusy omits the requested calendar', async () => {
    const { fetchFn } = fakeFetch((url) =>
      url.includes('oauth2.googleapis.com')
        ? new Response(TOKEN_BODY, { status: 200 })
        : jsonResponse({ calendars: {} }),
    );

    const provider = new GoogleCalendarProvider(CREDENTIALS, fetchFn);
    await expect(
      provider.getBusyIntervals({
        calendarId: 'cal-1',
        from: new Date(),
        to: new Date(),
      }),
    ).rejects.toThrow('missing the requested calendar');
  });

  it('sends a timeout signal on every request so hung calls fail closed', async () => {
    const { fetchFn, requests } = fakeFetch((url) =>
      url.includes('oauth2.googleapis.com')
        ? new Response(TOKEN_BODY, { status: 200 })
        : jsonResponse({ calendars: { 'cal-1': { busy: [] } } }),
    );

    const provider = new GoogleCalendarProvider(CREDENTIALS, fetchFn);
    await provider.getBusyIntervals({
      calendarId: 'cal-1',
      from: new Date('2026-09-02T01:00:00Z'),
      to: new Date('2026-09-02T10:00:00Z'),
    });

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('never leaks credentials in token refresh failures', async () => {
    const { fetchFn } = fakeFetch(
      () => new Response('error_description=secret refresh-token stuff', { status: 400 }),
    );

    const provider = new GoogleCalendarProvider(CREDENTIALS, fetchFn);
    await expect(
      provider.getBusyIntervals({ calendarId: 'cal-1', from: new Date(), to: new Date() }),
    ).rejects.toThrow('Google token refresh failed with status 400.');
  });
});

describe('OutlookCalendarProvider', () => {
  it('parses Graph datetimes, skips free events, and follows pagination', async () => {
    const page2Url = 'https://graph.microsoft.com/v1.0/next-page';
    const { fetchFn } = fakeFetch((url) => {
      if (url.includes('login.microsoftonline.com')) {
        return new Response(TOKEN_BODY, { status: 200 });
      }
      if (url === page2Url) {
        return jsonResponse({
          value: [
            {
              start: { dateTime: '2026-09-02T05:00:00.0000000', timeZone: 'UTC' },
              end: { dateTime: '2026-09-02T06:00:00.0000000', timeZone: 'UTC' },
              showAs: 'busy',
            },
          ],
        });
      }
      return jsonResponse({
        value: [
          {
            start: { dateTime: '2026-09-02T02:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-09-02T03:00:00.0000000', timeZone: 'UTC' },
            showAs: 'busy',
          },
          {
            start: { dateTime: '2026-09-02T03:00:00.0000000', timeZone: 'UTC' },
            end: { dateTime: '2026-09-02T04:00:00.0000000', timeZone: 'UTC' },
            showAs: 'free',
          },
        ],
        '@odata.nextLink': page2Url,
      });
    });

    const provider = new OutlookCalendarProvider(CREDENTIALS, fetchFn);
    const busy = await provider.getBusyIntervals({
      calendarId: '',
      from: new Date('2026-09-02T01:00:00Z'),
      to: new Date('2026-09-02T10:00:00Z'),
    });

    expect(busy).toEqual([
      {
        start: new Date('2026-09-02T02:00:00Z'),
        end: new Date('2026-09-02T03:00:00Z'),
      },
      {
        start: new Date('2026-09-02T05:00:00Z'),
        end: new Date('2026-09-02T06:00:00Z'),
      },
    ]);
  });

  it('uses the default calendar path when calendarId is empty', async () => {
    const { fetchFn, requests } = fakeFetch((url) =>
      url.includes('login.microsoftonline.com')
        ? new Response(TOKEN_BODY, { status: 200 })
        : jsonResponse({ value: [] }),
    );

    const provider = new OutlookCalendarProvider(CREDENTIALS, fetchFn);
    await provider.getBusyIntervals({
      calendarId: '',
      from: new Date('2026-09-02T01:00:00Z'),
      to: new Date('2026-09-02T10:00:00Z'),
    });

    const graphRequest = requests.find((request) =>
      request.url.includes('graph.microsoft.com'),
    );
    expect(graphRequest?.url).toContain('/me/calendar/calendarView');
  });

  it('creates events with UTC Graph datetimes and busy status', async () => {
    const { fetchFn, requests } = fakeFetch((url) =>
      url.includes('login.microsoftonline.com')
        ? new Response(TOKEN_BODY, { status: 200 })
        : jsonResponse({ id: 'evt-1' }),
    );

    const provider = new OutlookCalendarProvider(CREDENTIALS, fetchFn);
    const event = await provider.createEvent({
      calendarId: '',
      title: '[Booking] Service A - John Smith',
      start: new Date('2026-09-02T02:00:00Z'),
      end: new Date('2026-09-02T03:00:00Z'),
      description: 'Patient email: john@example.com',
    });

    expect(event.id).toBe('evt-1');
    const graphRequest = requests.find((request) =>
      request.url.includes('graph.microsoft.com'),
    );
    const payload = JSON.parse(String(graphRequest?.init.body));
    expect(payload.start).toEqual({
      dateTime: '2026-09-02T02:00:00.000',
      timeZone: 'UTC',
    });
    expect(payload.showAs).toBe('busy');
  });

  it('sends a timeout signal on every request so hung calls fail closed', async () => {
    const { fetchFn, requests } = fakeFetch((url) =>
      url.includes('login.microsoftonline.com')
        ? new Response(TOKEN_BODY, { status: 200 })
        : jsonResponse({ value: [] }),
    );

    const provider = new OutlookCalendarProvider(CREDENTIALS, fetchFn);
    await provider.getBusyIntervals({
      calendarId: '',
      from: new Date('2026-09-02T01:00:00Z'),
      to: new Date('2026-09-02T10:00:00Z'),
    });

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('rejects non-UTC datetimes from Graph', async () => {
    const { fetchFn } = fakeFetch((url) =>
      url.includes('login.microsoftonline.com')
        ? new Response(TOKEN_BODY, { status: 200 })
        : jsonResponse({
            value: [
              {
                start: { dateTime: '2026-09-02T10:00:00.0000000', timeZone: 'Asia/Taipei' },
                end: { dateTime: '2026-09-02T11:00:00.0000000', timeZone: 'Asia/Taipei' },
                showAs: 'busy',
              },
            ],
          }),
    );

    const provider = new OutlookCalendarProvider(CREDENTIALS, fetchFn);
    await expect(
      provider.getBusyIntervals({ calendarId: '', from: new Date(), to: new Date() }),
    ).rejects.toThrow('Expected UTC datetimes');
  });
});
