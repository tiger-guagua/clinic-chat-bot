# Architecture, Cost, and Safety

One Node.js process serves the frontend, the API, and every business rule — and the AI
is never trusted with booking correctness. This document explains how, why, what it
costs, and where the limits are. Clinic operators should read
[clinic-guide.md](clinic-guide.md) instead.

## 1. Architecture

The system is one Node.js/TypeScript application. It serves a static frontend and a small
JSON API from the same Express process.

```text
Browser (vanilla HTML/JS, browser owns chat history)
  |
  |  POST /api/chat        {messages: [...]} -> assistant reply
  |  POST /api/transcribe  multipart audio   -> {text}
  |  POST /api/speech      {text}            -> audio/mpeg
  v
Express (helmet, rate limit, request IDs, zod request validation)
  |
  +-- ConversationService
  |     - builds the system prompt (current clinic date/time, closed days)
  |     - runs the tool-calling loop (max 8 iterations)
  |     |
  |     +-- AIProvider (interface) --- OpenAIProvider (chat, STT, TTS)
  |     |
  |     +-- ToolExecutor
  |           - parses and zod-validates every tool argument
  |           - maps BookingErrors to structured tool results
  |
  +-- BookingService (deterministic authority)
        - service catalog + professional eligibility
        - clinic hours, closed weekdays, slot grid, past-time rules
        - re-checks availability immediately before event creation
        |
        +-- SlotCalculator (pure continuous-window math)
        |
        +-- CalendarProvider (interface)
              +-- GoogleCalendarProvider   (freeBusy + events.insert)
              +-- OutlookCalendarProvider  (calendarView + events create)
```

### Module boundaries

| Module | Responsibility | Never does |
|---|---|---|
| `src/domain` | Service catalog, types | I/O |
| `src/booking` | All business rules, slot math | Provider-specific code |
| `src/calendar` | Provider adapters behind one interface | Business decisions |
| `src/ai` | Model access behind one interface | Business decisions |
| `src/conversation` | Prompt, tool loop, argument revalidation | Direct calendar access |
| `src/routes` | HTTP validation and mapping | Business logic |

### Provider abstractions

Both external dependencies sit behind interfaces chosen for replaceability, which the
assignment requires:

- `CalendarProvider` (`getBusyIntervals`, `createEvent`): adding a third calendar system
  means one new class and one new entry in the provider map in `src/calendar/registry.ts`.
  No other file changes.
- `AIProvider` (`chat`, `transcribe`, `speak`): swapping OpenAI for another vendor means
  one new class implementing three methods. The tool definitions are plain JSON schema and
  the message format is provider-neutral, so no conversation logic changes.

## 2. Why this architecture

- **Fast to build and easy to review.** One process, no infrastructure. An interviewer can
  clone, configure, and run it in minutes.
- **Exactly enough abstraction.** The two interfaces above cover the requested provider
  independence. There is no plugin framework, no dependency-injection container, and no
  event bus, because nothing requires them.
- **The AI is not trusted with correctness.** Model output selects *which* tool to call.
  The backend decides *whether the action is allowed*. This split keeps hallucination away
  from booking integrity: even a model that invents a slot cannot create an event, because
  the backend re-reads the calendar first.
- **Easy to deploy.** `npm run build && npm start` plus a `.env` file runs anywhere Node 20
  runs. No premature microservices.

### Notable implementation choices

- **Calendar adapters use raw REST (native `fetch`), not the vendor SDKs.** Each adapter
  needs two endpoints plus an OAuth token refresh. The Google SDK is large; MSAL hides
  refresh tokens, which this delegated flow manages explicitly. Symmetric ~200-line
  adapters are easier to audit than two different SDK integration styles.
- **The OpenAI SDK stayed** because multipart audio upload and typed tool-calling are
  genuinely simpler with it.
- **Busy detection on Outlook uses `calendarView`** (events with `showAs != 'free'`)
  because Microsoft Graph does not offer `getSchedule` free/busy for personal accounts.
- **Slot = (professional, start time).** Two free professionals at 13:00 are two slots.
  Choosing a slot always determines the professional; the backend never auto-assigns.

## 3. Cost

No production traffic exists, so this section gives the cost drivers and a formula with
clearly labeled assumptions instead of invented usage numbers.

### Cost drivers

| Driver | Price basis (2026-08, USD) |
|---|---|
| Chat model (`gpt-4o-mini`) | $0.15 / 1M input tokens, $0.60 / 1M output tokens |
| Transcription (`whisper-1`) | $0.006 / audio minute |
| Text-to-speech (`tts-1`) | $15 / 1M characters |
| Google Calendar API | Free at this volume (quota: 1M requests/day) |
| Microsoft Graph | Free at this volume |
| Hosting | One small VM or container, ~$5-20 / month |
| Logging/monitoring | $0 (stdout) locally; ~$0-10 / month with a hosted collector |

### Formula

```text
Monthly AI cost =
    chat requests x avg input tokens  x input price
  + chat requests x avg output tokens x output price
  + audio minutes x transcription price
  + spoken characters x TTS price
```

### Worked example (assumptions labeled, not measured)

Assume: 1,000 conversations/month, 6 requests per conversation, ~2,000 input tokens and
~150 output tokens per request (system prompt + history + tool results), 200 voice minutes,
100,000 TTS characters.

```text
Chat input:   6,000 x 2,000 tokens = 12.0M x $0.15/M = $1.80
Chat output:  6,000 x   150 tokens =  0.9M x $0.60/M = $0.54
Transcription: 200 min x $0.006                      = $1.20
TTS:          100k chars x $15/M                     = $1.50
AI total                                             ~ $5.04 / month
+ hosting ($5-20)                                    ~ $10-25 / month total
```

### Build cost (measured for this project)

This MVP was designed and built in roughly one working day using an AI coding assistant.
Actual out-of-pocket costs for the build session:

| Item | Approx. cost (USD) |
|---|---|
| AI coding-assistant usage (design interview + 9 phases + live testing) | ~$45 |
| OpenAI API spend during live testing (~12 chat calls, 2 transcriptions, 2 TTS) | < $0.10 |
| OpenAI minimum credit purchase (mostly unused, funds future demos) | $5 |
| Google Cloud / Microsoft Azure | $0 (free tiers) |
| **Total** | **~$50** |

Engineer time is excluded. Maintenance in production is dominated by dependency updates
and credential rotation (Google/Microsoft client secrets and OpenAI keys expire or get
rotated), not by feature code.

## 4. Safety and security

- **Limited tool surface.** The model can call exactly three tools. There is no generic
  HTTP tool, no query tool, and no way for the model to reach arbitrary calendars: the
  professional-to-calendar mapping is fixed server-side.
- **Deterministic validation.** Every tool argument is zod-validated, then re-validated by
  `BookingService` against the catalog, eligibility, clinic hours, the slot grid, closed
  weekdays, and past-time rules. Model-supplied IDs are treated as untrusted (including
  case normalization, found necessary in live testing).
- **Explicit confirmation.** `book_appointment` refuses unless `confirmed === true`, and
  the system prompt forbids booking in the same turn the details first arrive.
- **Availability re-check.** The professional's calendar is re-read immediately before
  `createEvent`. A slot shown earlier in the conversation is never trusted.
- **Fail closed.** Any provider failure aborts the whole lookup with
  `CALENDAR_PROVIDER_ERROR`. The app never reports availability it did not read.
- **No medical advice.** Enforced by prompt and by the absence of any tool that could
  provide it. Refusals redirect to clinic staff.
- **Input validation.** JSON body limit 100 KB; 1-60 chat messages; audio uploads capped
  at 25 MB and type-checked; TTS input capped at 500 characters.
- **Secrets.** All credentials live in `.env` (git-ignored). Helper scripts write minted
  refresh tokens directly into `.env`, never to the terminal. Token-endpoint error bodies
  are not propagated because they can echo credentials.
- **Safe logging.** Structured JSON logs carry request IDs, error codes, operation names,
  and IDs — never tokens, authorization headers, or more patient data than necessary.
- **Safe errors.** Browser-facing errors are code + short message. Stack traces and
  provider responses stay in server logs.
- **Abuse limits.** helmet security headers; 30 requests/min per IP on `/api/` (the
  endpoints spend OpenAI credit and are unauthenticated); 8-iteration cap on the model's
  tool loop.

## 5. Known limitations

- **No persistent database.** Chat history lives in the browser; bookings live only in the
  calendars.
- **Concurrency window.** Two users can pass the re-check for the same slot at nearly the
  same instant:

  ```text
  A checks slot -> free
  B checks slot -> free
  A creates event
  B creates event      <- double booking
  ```

  The re-check shrinks this window to sub-seconds but cannot close it without an
  authoritative reservation store. Accepted for the MVP; see section 6.
- No cancellation, rescheduling, reminders, or waitlist.
- No customer authentication; anyone who reaches the page can book.
- Calendar credentials are preconfigured; there is no operator OAuth onboarding UI.
- Clinic hours are simple and static; there is no holiday/special-hours engine.
- The Google OAuth consent screen runs in Testing mode (sensitive scope, unverified app),
  which is appropriate for a demo but not for public production use.

## 6. Production evolution

Mentioned, deliberately not implemented:

- A database with a reservations table; slot acquisition via unique constraint or
  distributed lock closes the double-booking window.
- Idempotency keys on booking requests to survive retries.
- Audit trail of every booking attempt and outcome.
- OAuth onboarding UI so clinic staff connect calendars without editing `.env`.
- Configurable services, hours, and holidays per clinic.
- Retries with backoff and circuit breakers around both providers.
- Monitoring and alerting on provider failures and booking conflicts.
- Cancellation/rescheduling flows and patient notifications (email/SMS).
- Google app verification (or a marketplace listing) to leave Testing mode.
