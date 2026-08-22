/**
 * One-time helper: mints a Microsoft refresh token via the OAuth consent flow
 * (personal-account "consumers" authority) and writes it into .env as
 * MICROSOFT_REFRESH_TOKEN (never printed to the terminal).
 *
 * Usage: npx tsx scripts/get-microsoft-refresh-token.ts
 * Stop the app first if it is running: this script listens on the same port.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { updateEnvVar } from './envFile';

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'offline_access https://graph.microsoft.com/Calendars.ReadWrite';

const clientId = process.env.MICROSOFT_CLIENT_ID;
const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const redirectUri =
  process.env.MICROSOFT_REDIRECT_URI ?? 'http://localhost:3000/auth/microsoft/callback';

if (!clientId || !clientSecret) {
  console.error('Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const redirectUrl = new URL(redirectUri);
const state = randomBytes(16).toString('hex');

const authUrl = new URL(`${AUTHORITY}/authorize`);
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('response_mode', 'query');
authUrl.searchParams.set('scope', SCOPE);
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
        throw new Error(
          `Microsoft returned an error: ${error} ${url.searchParams.get('error_description') ?? ''}`,
        );
      }
      const code = url.searchParams.get('code');
      if (!code) {
        throw new Error('Microsoft did not return an authorization code.');
      }

      const tokenResponse = await fetch(`${AUTHORITY}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: SCOPE,
        }).toString(),
      });
      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed with status ${tokenResponse.status}.`);
      }

      const tokens = (await tokenResponse.json()) as { refresh_token?: string };
      if (!tokens.refresh_token) {
        throw new Error('No refresh token in the response; check the offline_access scope.');
      }

      updateEnvVar('.env', 'MICROSOFT_REFRESH_TOKEN', tokens.refresh_token);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2>Microsoft refresh token saved to .env. You can close this tab.</h2>');
      console.info('MICROSOFT_REFRESH_TOKEN saved to .env.');
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
  console.info('Open this URL in your browser and sign in with the clinic Microsoft account:');
  console.info(authUrl.toString());
});
