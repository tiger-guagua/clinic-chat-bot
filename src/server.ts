import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import { ConfigError, loadConfig } from './config';

function main(): void {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = express();

  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
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
