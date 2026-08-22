# Dental Appointment Assistant

A dental-clinic appointment-booking assistant. Patients talk to an AI assistant by text or
voice. The assistant checks the real calendars of the clinic professionals in Google Calendar
and Microsoft Outlook, and books appointments after explicit confirmation.

The core design rule: **the AI understands intent; the backend enforces every business rule.**
The model can only call three tools. The backend independently validates every argument and
re-checks availability immediately before it creates any calendar event.

## Demo

Start the app (see Quick Start), open <http://localhost:3000>, and try:

1. `What services do you offer?` — lists the catalog with durations.
2. `Show me service C slots on Monday` — only Senior 1 / Senior 2 appear; Junior is not
   eligible for service C.
3. `Show me service E appointments tomorrow` — only continuous 6-hour windows are offered.
4. Pick a slot, give a name and email, confirm — the event appears in the professional's
   real calendar.
5. `What medication should I take for tooth pain?` — the assistant declines and refers you
   to clinic staff.
6. Hold the **Hold to talk** button and speak — the transcript appears in the input box for
   review before you send it.

## Features

- Text chat with tool-calling AI (OpenAI)
- Push-to-talk voice input (browser MediaRecorder + OpenAI transcription)
- Optional spoken replies (speaker button on each assistant message)
- Deterministic service catalog and professional eligibility rules
- Availability across two calendar providers: Google Calendar and Microsoft Outlook
- Continuous-window slot calculation (a 6-hour service needs 6 continuous free hours)
- Availability re-check immediately before every event creation
- Clinic hours, timezone, slot interval, and closed weekdays from configuration
- Rate limiting, security headers, structured JSON logs, safe error responses

## Architecture

```text
Browser (vanilla HTML/JS)
  |  POST /api/chat  /api/transcribe  /api/speech
  v
Express API
  +-- ConversationService ---- OpenAIProvider   (AIProvider interface)
  |         |
  |         +-- ToolExecutor   (revalidates every model argument with zod)
  |                 |
  |                 +-- BookingService          (all business rules live here)
  |                         |
  |                         +-- SlotCalculator  (continuous-window math)
  |                         +-- GoogleCalendarProvider   (CalendarProvider
  |                         +-- OutlookCalendarProvider   interface)
```

See [docs/architecture.md](docs/architecture.md) for the reasoning, cost model, and safety
design.

## Prerequisites

- Node.js 20 or newer
- An OpenAI API key with billing credit
- A Google account with a Google Cloud OAuth client (for the Google-side calendars)
- A Microsoft account with an Azure app registration (for the Outlook calendar)

[docs/clinic-guide.md](docs/clinic-guide.md) walks through every account setup step.

## Quick Start

```bash
git clone https://github.com/tiger-guagua/clinic-chat-bot.git
cd clinic-chat-bot
npm install
cp .env.example .env
# Fill in .env (see Environment Variables), then mint the two refresh tokens:
npx tsx scripts/get-google-refresh-token.ts
npx tsx scripts/get-microsoft-refresh-token.ts
# Optional: verify both calendar connections
npx tsx scripts/verify-calendars.ts
npm run dev
```

Open <http://localhost:3000>.

## Environment Variables

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `CLINIC_TIMEZONE` | IANA timezone of the clinic, e.g. `Asia/Taipei` |
| `CLINIC_OPEN_HOUR` / `CLINIC_CLOSE_HOUR` | Opening hours, `HH:MM` 24-hour format |
| `SLOT_INTERVAL_MINUTES` | Slot grid granularity (default 30) |
| `CLINIC_CLOSED_WEEKDAYS` | Comma-separated closed days, e.g. `sunday` |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_CHAT_MODEL` | Chat model (default `gpt-4o-mini`) |
| `OPENAI_STT_MODEL` | Transcription model (default `whisper-1`) |
| `OPENAI_TTS_MODEL` | Text-to-speech model (default `tts-1`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client |
| `GOOGLE_REDIRECT_URI` | Must match the OAuth client config |
| `GOOGLE_REFRESH_TOKEN` | Written by the Google helper script |
| `GOOGLE_CALENDAR_JUNIOR` / `GOOGLE_CALENDAR_SENIOR1` | Google calendar IDs |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Azure app registration |
| `MICROSOFT_REDIRECT_URI` | Must match the app registration config |
| `MICROSOFT_REFRESH_TOKEN` | Written by the Microsoft helper script |
| `MICROSOFT_CALENDAR_SENIOR2` | Outlook calendar ID; empty = default calendar |

The server refuses to start and names the missing variables if configuration is incomplete.

## Google Calendar Setup

Short version (full steps in [docs/clinic-guide.md](docs/clinic-guide.md)):

1. Create a Google Cloud project and enable the **Google Calendar API**.
2. Create an OAuth client (type **Web application**) with redirect URI
   `http://localhost:3000/auth/google/callback`.
3. Keep the consent screen in **Testing** mode and add the calendar-owner account as a
   **test user**. Note: Testing-mode refresh tokens expire after 7 days — re-run the
   token helper if calendar access stops working.
4. Put the client ID/secret and the calendar IDs into `.env`.
5. Run `npx tsx scripts/get-google-refresh-token.ts` and sign in. The refresh token is
   written into `.env` automatically.

## Microsoft Outlook Setup

1. Register an app in the Azure portal. Supported account types must include
   **personal Microsoft accounts**.
2. Add redirect URI `http://localhost:3000/auth/microsoft/callback` (type Web) and create a
   client secret.
3. Put the client ID/secret into `.env`.
4. Run `npx tsx scripts/get-microsoft-refresh-token.ts` and sign in with the calendar-owner
   account. The refresh token is written into `.env` automatically.

## Run Locally

```bash
npm run dev     # development with reload
npm run build   # compile TypeScript to dist/
npm start       # run the compiled server
```

## Run Tests

```bash
npm test
```

Run one file or one test:

```bash
npx vitest run test/SlotCalculator.test.ts
npx vitest run -t "requires a continuous 6-hour window"
```

## Design Decisions

- **The LLM is never authoritative.** It sees three tools (`get_services`, `find_slots`,
  `book_appointment`). The backend revalidates every argument with zod and enforces
  eligibility, clinic hours, the slot grid, and availability on its own.
- **Booking always re-checks.** `book_appointment` re-reads the professional's calendar
  immediately before creating the event, and refuses unless `confirmed === true`.
- **Fail closed.** If a calendar provider call fails, the whole availability lookup fails.
  The app never invents availability.
- **Raw REST for calendars.** Each provider needs two API calls plus a token refresh; the
  official SDKs added weight without benefit, and MSAL hides the refresh tokens this flow
  manages itself. The OpenAI SDK stayed because it genuinely simplifies audio upload.
- **No database.** The browser holds the chat history; the calendars are the source of
  truth for availability. See Known Limitations.

## Safety

- Scheduling only: the system prompt forbids medical advice, and the backend gives the
  model no tool that could provide it.
- All tool arguments are treated as untrusted input.
- Explicit confirmation is required before any event is created.
- Secrets live in `.env` (git-ignored); helper scripts write tokens to disk, never to the
  terminal.
- Rate limiting (30 requests/min per IP) protects the unauthenticated endpoints.
- Errors sent to the browser never contain stack traces or provider internals.

## Known Limitations

- No persistent database; no cancellation, rescheduling, reminders, or patient accounts.
- A race between two simultaneous bookings of the same slot is narrowed by the final
  re-check but not fully eliminated (see docs/architecture.md).
- Calendar credentials are preconfigured by the operator; there is no OAuth onboarding UI.
- Clinic hours are static per environment; there is no holiday calendar.
- English only.

## Production Improvements

Described (not built) in [docs/architecture.md](docs/architecture.md): reservation store
with locking, idempotency keys, audit trail, OAuth onboarding, retries with backoff,
monitoring, cancellation/rescheduling, notifications.

## Documentation

- [docs/architecture.md](docs/architecture.md) — internal: architecture, cost, safety
- [docs/design-decisions.md](docs/design-decisions.md) — decision log: what was chosen, why, and what was rejected
- [docs/clinic-guide.md](docs/clinic-guide.md) — external: clinic installation and usage
