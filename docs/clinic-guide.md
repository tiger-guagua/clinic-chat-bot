# Clinic Guide — Dental Appointment Assistant

This guide is for the clinic operator. You do not need to be a programmer. Follow the
steps in order. Where a step happens outside the app (Google, Microsoft, OpenAI), this
guide shows you where to click.

## 1. What the product does

The assistant is a web page with a chat box. Patients type or speak in English. The
assistant can:

- explain your services and how long each one takes;
- show free appointment times for the correct professionals;
- book an appointment after the patient confirms.

Every booking appears directly in the professional's own calendar (Google Calendar or
Outlook), so your staff keep using the calendars they already know.

## 2. What the bot can and cannot do

**Can:** list services, check availability, book appointments, answer in English.

**Cannot:** give medical advice, recommend medication, diagnose, cancel or move
appointments, answer questions unrelated to scheduling. If a patient asks for medical
help, the bot tells them to contact clinic staff.

## 3. Supported services

| Service | Duration | Who can perform it |
|---|---|---|
| A | 60 min | Junior, Senior 1, Senior 2 |
| B | 60 min | Junior, Senior 1, Senior 2 |
| C | 150 min | Senior 1, Senior 2 |
| D | 120 min | Senior 1, Senior 2 |
| E | 360 min | Senior 1, Senior 2 |

The bot never offers Junior for services C, D, or E. A long service is only offered when
the professional has the full time free in one continuous block.

## 4. Required accounts

You need four things before installation:

1. A **Google account** that owns the calendars for Junior and Senior 1.
2. A **Microsoft account** (a free personal account from outlook.com works) that owns the
   calendar for Senior 2.
3. An **OpenAI account** with an API key and a small amount of prepaid credit
   (<https://platform.openai.com> — the minimum $5 purchase lasts a long time).
4. A computer or server with **Node.js 20 or newer** installed (<https://nodejs.org>).

## 5. Google Calendar setup

1. In Google Calendar, create two calendars (for example "Junior" and "Senior 1").
   For each calendar: Settings -> "Integrate calendar" -> copy the **Calendar ID**
   (it looks like `abc123...@group.calendar.google.com`).
2. Go to <https://console.cloud.google.com> and create a project.
3. Enable the **Google Calendar API**: menu "APIs & Services" -> "Library" -> search
   "Google Calendar API" -> Enable.
4. Create the OAuth client: "APIs & Services" -> "Credentials" -> "Create credentials" ->
   "OAuth client ID" -> type **Web application**. Under "Authorized redirect URIs" add:

   ```text
   http://localhost:3000/auth/google/callback
   ```

   Save the **Client ID** and **Client secret**.
5. Add yourself as a test user: "Google Auth Platform" -> "Audience" -> "Test users" ->
   add the Google account email from step 1. Keep the publishing status on **Testing**.
   (Without this step, sign-in fails with error 403 access_denied.)

## 6. Microsoft Outlook setup

1. Sign in to <https://portal.azure.com> with the Microsoft account for Senior 2.
2. Search "App registrations" -> "New registration".
   - Supported account types: choose the option that includes
     **personal Microsoft accounts**.
   - Redirect URI: platform **Web**, value:

     ```text
     http://localhost:3000/auth/microsoft/callback
     ```
3. On the app page, copy the **Application (client) ID**.
4. Create a secret: "Certificates & secrets" -> "New client secret" -> copy the secret
   **Value** immediately (it is shown only once).

## 7. Configure the application

1. Get the code and install:

   ```bash
   git clone https://github.com/tiger-guagua/clinic-chat-bot.git
   cd clinic-chat-bot
   npm install
   cp .env.example .env
   ```

2. Open `.env` in a text editor and fill in:
   - clinic settings: timezone, opening hours, closed weekdays;
   - `OPENAI_API_KEY`;
   - the Google client ID/secret and the two calendar IDs;
   - the Microsoft client ID/secret. Leave `MICROSOFT_CALENDAR_SENIOR2` empty to use the
     account's main calendar.

3. Connect the calendars (one time only). Each command prints a link — open it, sign in
   with the right account, and approve. The app saves the token by itself:

   ```bash
   npx tsx scripts/get-google-refresh-token.ts
   npx tsx scripts/get-microsoft-refresh-token.ts
   ```

4. Check the connections:

   ```bash
   npx tsx scripts/verify-calendars.ts
   ```

   You should see `[OK]` for junior, senior1, and senior2.

## 8. Start the application

```bash
npm run build
npm start
```

Open <http://localhost:3000> in a browser. To run it on a server for patients, put it
behind HTTPS (for example with a reverse proxy); the microphone feature requires HTTPS on
everything except `localhost`.

## 9. How patients use chat

The patient types a message like "I'd like service C on Monday". The assistant shows free
times with the professional's name. The patient picks a time and gives their name and
email. The assistant repeats the full appointment and asks for a final yes. Only after
that yes is the appointment created.

## 10. How patients use voice

The patient presses and holds **Hold to talk**, speaks, and releases. The words appear in
the message box so the patient can correct them before sending. The browser asks for
microphone permission the first time. Each assistant reply also has a small speaker
button that reads the reply aloud.

## 11. How bookings appear in calendars

Each booking is a normal calendar event in the professional's calendar:

- Title: `[Booking] Service C - John Smith`
- Time: the booked slot
- Description: the patient's email and a note that the assistant created it

Staff can open, move, or delete these events like any other event. If staff add their own
events (holidays, meetings), the assistant automatically stops offering those times.

## 12. Troubleshooting

**Calendar access failure** (`[FAIL]` from the verify script, or "calendar service is
unavailable" in chat): the saved token may have expired or been revoked. Run the two
token commands from section 7 step 3 again. Note: while the Google consent screen is in
**Testing** mode, Google refresh tokens expire after **7 days** — re-run the Google token
command before any demo if more than a week has passed. Also check that the Calendar API
is still enabled (Google) and the client secret has not expired (Microsoft secrets expire
after 6-24 months).

**No available slots**: check that the date is not a closed weekday, that the calendars
are not fully booked, and that the service duration fits before closing time (service E
needs 6 continuous hours, so the last possible start is 12:00 with 09:00-18:00 hours).

**Voice input not working**: the browser needs microphone permission, and the page must
be `localhost` or HTTPS. If words come out wrong, speak closer to the microphone; the
text can be corrected in the message box before sending.

**AI provider unavailable** ("assistant is temporarily unavailable"): check the OpenAI
status page and your credit balance at <https://platform.openai.com/settings/organization/billing>.
The app refuses to invent answers when the AI service is down.

## 13. Security notes

- Never share your `.env` file, API keys, or client secrets. Anyone with these can read
  and write your calendars and spend your OpenAI credit.
- If a key or secret leaks, revoke it at once: OpenAI keys at platform.openai.com, the
  Google client in Cloud Console credentials, the Microsoft secret in the Azure portal.
  Then create a new one and run the setup commands again.
- The app already limits request rates and never shows patients any internal error
  details, but it has no patient login. Do not expose it to the public internet without
  considering who may book.
- Patient names and emails appear only inside calendar events in your own calendars. Do
  not add more patient data to the events by hand.
