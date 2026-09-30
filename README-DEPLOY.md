# Aurorael — deployment notes

## Required Vercel Environment Variables

Create these exact variable names in Vercel:

- AI_API_URL
- AI_API_KEY
- AI_MODEL_PRIMARY
- AI_MODEL_FALLBACK
- AURORAEL_SYSTEM_PROMPT

`AI_API_KEY` and the complete system prompt must never be committed to GitHub.

After creating or editing the variables, deploy a NEW Production deployment.
Changing an environment variable does not retroactively change an old deployment.

## If `/api/route` returns 500

Open Vercel -> Logs, make one request, then inspect the latest `/api/route`.
This version logs only safe configuration diagnostics, for example:

[Aurorael] Missing environment variables: AI_API_KEY

It never prints the key itself.

## Important cleanup

This project uses `services/modelService.js`.

Do not commit `node_modules`.
