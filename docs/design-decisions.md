# Design Decisions

A record of the decisions made while designing and building this MVP, with the reasoning
and the alternatives that were rejected. Architecture details live in
[architecture.md](architecture.md); this file records *why* things are the way they are.

## Domain language

Terms used consistently across code, docs, and the assistant itself:

- **Professional** — one of the clinic's three practitioners (`junior`, `senior1`,
  `senior2`). Each owns exactly one calendar. (Not: dentist, doctor, staff.)
- **Service** — a bookable treatment type (`A`-`E`) with a fixed duration and a fixed set
  of eligible Professionals.
- **Eligibility** — whether a Professional may perform a Service. Defined solely by the
  service catalog in code; never decided by the AI.
- **Slot** — one bookable unit: a (Professional, start time) pair for a given Service and
  date. Two free Professionals at the same time are two Slots; choosing a Slot determines
  the Professional.
- **Busy Interval** — a time range during which a Professional's calendar is occupied, as
  reported by their calendar provider.
- **Recheck** — the mandatory re-verification of a Slot's availability immediately before
  the calendar event is created. No booking without a passed Recheck.
- **Confirmation** — the Patient's explicit "yes" to the summarized appointment. No event
  may be created without it.
- **Patient** — the person chatting with the assistant. (Not: customer, client, user.)
- **Closed Day** — a weekday on which the clinic accepts no bookings (default: Sunday).
  Enforced by the backend, not by the AI's phrasing.

## Scheduling semantics

**A Slot binds a professional, not just a time.**
If both seniors are free at 13:00, the patient sees two slots. The alternative
(time-first slots with backend auto-assignment) hides who the patient will see.

**"Tomorrow" is resolved by the backend clock, not the model's guess.**
The system prompt is rebuilt every turn with the current date/time in the clinic
timezone. `find_slots` rejects past dates; on the current day, already-elapsed start
times are excluded with no extra lead-time buffer.

**Closed days return a structured result, not an empty list.**
`find_slots` on a Sunday returns `clinicClosed` with the weekday, so the assistant can
say *why* there are no slots and suggest another day. `book_appointment` rejects closed
days independently — the rule lives in the backend, not in the assistant's manners.

**Booking horizon: past rejected, future unbounded.**
A future cap would be a rule the assignment never asked for; the absence is documented
as a known limitation.

**Continuous windows only.**
A 360-minute service is offered only when six continuous hours are free. A single
30-minute booking in the middle of the day removes every 6-hour window — covered by an
explicit unit test.

## Trust boundary with the AI

**The LLM is never authoritative.** It sees exactly three tools. Every argument it sends
is revalidated: zod at the tool boundary, then the full rule set (catalog, eligibility,
hours, grid alignment, closed days, past times) in `BookingService`. Model-supplied IDs
are normalized (live testing showed the model passes display-name casing like "Junior").

**Summarize, then a final yes.** `book_appointment` refuses unless `confirmed === true`,
and the prompt forbids booking in the same turn the details first arrive — even when the
user pre-confirms ("book it, I confirm"). Live testing showed the model would otherwise
happily book in one turn; the demo requirement is an explicit summary-and-confirm step.

**Fail closed on provider errors.** If any eligible professional's calendar cannot be
read, the whole lookup fails with a safe error. Partial results (slots from the working
provider plus a caveat) were considered and rejected for the MVP: the model tends to
paraphrase caveats away, and a deterministic all-or-nothing rule is easier to reason
about. Partial availability is listed as a production improvement.

## Calendar integration

**Raw REST with native `fetch` instead of the vendor SDKs.**
Each provider needs two endpoints plus one OAuth token refresh. The Google SDK is large;
MSAL deliberately hides refresh tokens, which this delegated flow must manage itself.
Two symmetric ~200-line adapters are easier to audit than two different SDK styles.
(The OpenAI SDK *was* kept — multipart audio upload and typed tool-calling genuinely
benefit from it. The rule was value per dependency, not "no SDKs".)

**Outlook busy times come from `calendarView`, not `getSchedule`.**
Microsoft Graph does not offer the free/busy API for personal accounts. Events with
`showAs != 'free'` are treated as busy; Graph datetimes are normalized to UTC and
pagination is followed.

**Refresh tokens are minted by one-time helper scripts that write straight into `.env`.**
Tokens never appear on stdout, so they cannot leak into terminal transcripts or logs.
The scripts double as operator documentation for the clinic guide.

**Google consent stays in Testing mode.**
The `calendar` scope is sensitive; publishing the OAuth app would trigger Google's
verification review. Testing mode plus a registered test user is the right shape for a
demo — hit live as a 403 `access_denied` and documented in the clinic guide.

**Event content is minimal.** Title `[Booking] Service X - Name`, patient email in the
description, no attendee invites (invites would email patients and require extra
permissions). PII stays inside the professional's own calendar.

## Conversation and voice

**The browser owns the chat history** and sends it with each request (per the spec's
stateless-backend requirement). Request limits: 60 messages, 100 KB body, 8 tool-loop
iterations per turn with a safe fallback.

**Transcripts are reviewed, not auto-sent.** User testing showed speech recognition
misses ("service A" heard as "service day"); the transcript fills the input box so the
patient can correct it before sending.

**The transcription request seeds the clinic vocabulary.** The STT prompt lists the
service letters and professional names, biasing recognition toward exactly the words
that matter here.

**TTS was deferred, then included.** It sat first on the cut list; once everything else
was verified and the TTS model had already been proven during transcription testing, the
remaining cost was ~70 lines.

## Security posture

Driven by an explicit customer concern beyond the written requirements:

- helmet security headers; same-origin only (no CORS).
- 30 requests/min per IP on `/api/` — the endpoints are unauthenticated and spend AI
  credit, so throttling is cost protection as much as abuse protection.
- Token-endpoint error bodies are never propagated (they can echo credentials).
- Browser-facing errors carry a code and a short message; stack traces and provider
  responses stay in server logs, keyed by request ID.
- Secrets live only in `.env` (git-ignored); the git history was scanned before
  publication and contains no secret values.

## Process notes

**Unit tests use fakes; the bugs came from live runs.** All 48 tests pass against fake
providers, but both model-behavior bugs (ID casing, one-turn booking) surfaced only when
a real model drove the tools. Both are now covered by code (normalization) or prompt
rules verified in a re-run.

**Fixed decision points over open-ended flexibility.** Professional-to-provider mapping
(junior + senior1 on Google, senior2 on Outlook) is fixed in the registry, not
configurable — it exercises both providers and keeps the demo deterministic. Making it
configurable is a straightforward production step, not an MVP requirement.
