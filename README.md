# Dental Appointment Assistant

A dental-clinic appointment-booking assistant: patients chat (text or voice) with an AI
assistant that checks real professional availability in Google Calendar and Microsoft Outlook,
and books appointments after explicit confirmation. The AI understands intent; the backend
enforces every business rule.

> Work in progress — full README (setup guides, architecture, design decisions) lands with
> the documentation phase.

## Quick Start

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev
```

Open <http://localhost:3000>.

## Scripts

```bash
npm run dev     # start with reload (tsx watch)
npm run build   # compile TypeScript to dist/
npm start      # run the compiled server
npm test       # run unit tests (vitest)
```

## Documentation

- `docs/architecture.md` — internal architecture, cost, and safety documentation (upcoming)
- `docs/clinic-guide.md` — external clinic installation and usage guide (upcoming)
