import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { OpenAIProvider } from './ai/OpenAIProvider';
import { BookingService } from './booking/BookingService';
import { buildProfessionalCalendars } from './calendar/registry';
import { ConfigError, loadAIConfig, loadCalendarConfig, loadConfig } from './config';
import { ConversationService } from './conversation/ConversationService';
import { ToolExecutor } from './conversation/ToolExecutor';
import { createChatRouter } from './routes/chat';

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

  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(createChatRouter(conversationService));

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
