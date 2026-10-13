import { createHash } from 'node:crypto';

// Temporary build-only installation check. No endpoint, credential output or provider call.
const env = process.env;
if (env.VERCEL_ENV === 'production' && env.INSTAGRAM_CHALLENGE_DIAGNOSTIC === 'true') {
  const now = Date.now();
  const secret = env.INSTAGRAM_PARENT_WEBHOOK_APP_SECRET;
  const closed = ['INSTAGRAM_CONNECT_ENABLED','INSTAGRAM_RECEIVE_ENABLED','INSTAGRAM_ALLOW_EXTERNAL_SEND']
    .every(key => env[key] === 'false');
  if (!closed || now < Date.parse('2026-10-13T03:00:00Z') || now >= Date.parse('2026-10-15T03:00:00Z')
    || !secret || secret !== secret.trim() || env.INSTAGRAM_PARENT_WEBHOOK_APP_ID !== '3391832644330595') {
    throw new Error('Challenge installation diagnostic prerequisites not satisfied');
  }
  console.log('INSTAGRAM_PARENT_SOURCE_APP=3391832644330595');
  console.log('INSTAGRAM_PARENT_INSTALLED_SHA256=' + createHash('sha256').update(secret).digest('hex'));
}
