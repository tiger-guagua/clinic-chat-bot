import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { OpenAIProvider } from './ai/OpenAIProvider';
import { BookingService } from './booking/BookingService';
import { buildProfessionalCalendars } from './calendar/registry';
import { ConfigError, loadAIConfig, loadCalendarConfig, loadConfig } from './config';
import { ConversationService } from './conversation/ConversationService';
import { ToolExecutor } from './conversation/ToolExecutor';
import { createChatRouter } from './routes/chat';
import { createSpeechRouter } from './routes/speech';
import { createTranscribeRouter } from './routes/transcribe';

function main(): void {
  let config;
  let calendars;
  let aiConfig;
  try {
    config = loadConfig();
    calendars = buildProfessionalCalendars(loadCalendarConfig());
    aiConfig = loadAIConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const bookingService = new BookingService(calendars, config);
  const aiProvider = new OpenAIProvider(aiConfig);
  const toolExecutor = new ToolExecutor(bookingService, config);
  const conversationService = new ConversationService(aiProvider, toolExecutor, config);

  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Caps abuse of the unauthenticated endpoints (which spend OpenAI credit).
  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
      },
    }),
  );

  app.use((req, res, next) => {
    res.locals.requestId = randomUUID().slice(0, 8);
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(createChatRouter(conversationService));
  app.use(createTranscribeRouter(aiProvider));
  app.use(createSpeechRouter(aiProvider));

  app.use('/api/', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown API endpoint.' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(
      JSON.stringify({
        event: 'unhandled_error',
        requestId: res.locals.requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    if (!res.headersSent) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Something went wrong. Please try again.',
      });
    }
  });

  app.listen(config.port, () => {
    console.info(
      JSON.stringify({
        event: 'server_started',
        port: config.port,
        clinicTimezone: config.clinicTimezone,
      }),
    );
  });
}

main();
