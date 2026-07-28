import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';

const scriptId = process.env.GAS_SCRIPT_ID;
const output = process.env.GAS_PROJECT_OUTPUT || 'artifacts/project-source.json';
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

await fs.mkdir(path.dirname(output), { recursive: true });

try {
  if (!scriptId) throw new Error('GAS_SCRIPT_ID is required');
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Missing OAuth secrets: clientId=${Boolean(clientId)} clientSecret=${Boolean(clientSecret)} refreshToken=${Boolean(refreshToken)}`);
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  const api = google.script({ version: 'v1', auth });
  const response = await api.projects.getContent({ scriptId });
  const files = response.data.files || [];
  if (!files.length) throw new Error('Apps Script API returned no files');

  const payload = { ok: true, scriptId, files };
  await fs.writeFile(output, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, scriptId, fileCount: files.length, output }));
} catch (error) {
  const payload = {
    ok: false,
    scriptId,
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || null,
  };
  await fs.writeFile(output, JSON.stringify(payload, null, 2), 'utf8');
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}
