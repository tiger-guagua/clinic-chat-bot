/**
 * One-time helper: mints a Google refresh token via the OAuth consent flow and
 * writes it into .env as GOOGLE_REFRESH_TOKEN (never printed to the terminal).
 *
 * Usage: npx tsx scripts/get-google-refresh-token.ts
 * Stop the app first if it is running: this script listens on the same port.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { updateEnvVar } from './envFile';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri =
  process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback';

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const redirectUrl = new URL(redirectUri);
const state = randomBytes(16).toString('hex');

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
authUrl.searchParams.set('access_type', 'offline');
// Without prompt=consent Google may omit the refresh token on repeat consents.
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', state);

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', redirectUri);
    if (url.pathname !== redirectUrl.pathname) {
      res.writeHead(404).end();
      return;
    }

    try {
      if (url.searchParams.get('state') !== state) {
        throw new Error('OAuth state mismatch; run the script again.');
      }
      const error = url.searchParams.get('error');
      if (error) {
        throw new Error(`Google returned an error: ${error}`);
      }
      const code = url.searchParams.get('code');
      if (!code) {
        throw new Error('Google did not return an authorization code.');
      }

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed with status ${tokenResponse.status}.`);
      }

      const tokens = (await tokenResponse.json()) as { refresh_token?: string };
      if (!tokens.refresh_token) {
        throw new Error(
          'No refresh token in the response. Remove the app from ' +
            'https://myaccount.google.com/permissions and run this script again.',
        );
      }

      updateEnvVar('.env', 'GOOGLE_REFRESH_TOKEN', tokens.refresh_token);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2>Google refresh token saved to .env. You can close this tab.</h2>');
      console.info('GOOGLE_REFRESH_TOKEN saved to .env.');
      server.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Failed: ${message}`);
      console.error(`Failed: ${message}`);
      server.close();
      process.exitCode = 1;
    }
  })();
});

server.listen(Number(redirectUrl.port || 80), () => {
  console.info('Open this URL in your browser and sign in with the clinic Google account:');
  console.info(authUrl.toString());
});
