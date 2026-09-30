# Aurorael — public-safe source

This version keeps the model provider configuration and Aurorael's system instructions outside the public repository.

## Environment variables

Configure these only in your deployment platform:

- `AI_API_URL`
- `AI_API_KEY`
- `AI_MODEL_PRIMARY`
- `AI_MODEL_FALLBACK`
- `AURORAEL_SYSTEM_PROMPT`

Do not commit real values to Git.

## What changed

- The system prompt is no longer stored in `api/route.js`.
- The provider endpoint, credentials and model IDs are environment variables.
- The provider-specific SDK dependency has been removed.
- The server integration is now in `services/modelService.js`.
- Client-facing errors do not expose provider implementation details.
- `.gitignore` excludes local environment files and private notes.

## Vercel

Add all five environment variables in Project Settings → Environment Variables and enable them for the environments you use. Redeploy after saving them.
