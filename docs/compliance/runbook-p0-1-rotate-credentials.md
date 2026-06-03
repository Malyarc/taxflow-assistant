# P0-1 Runbook — Rotate the leaked Neon + Gemini credentials (OPERATOR / John)

**This is the one P0 item only you can do** — it needs the Neon and Google
consoles. Do it first; it closes a live, ongoing exposure of the production
database.

## Good news first — no git history scrub needed

I scanned the **entire git history** (`git log --all -p`) for the leaked
patterns:

- Google API keys (`AIza…`): **none ever committed**
- Neon / Postgres connection strings with credentials: **none ever committed**
  (only the `.env.example` placeholder `postgres://user:password@localhost`)
- A real `.env` file: **never committed** (`.env` is gitignored)

So the credentials leaked **outside** the repo (pasted in chat / lived only in
the pm2 process env). **You do NOT need `git filter-repo`, history rewriting, or
a force-push.** Rotation in the consoles fully closes it. (A leaked secret is
compromised forever — rotation, not deletion, is the only real fix.)

---

## Step 1 — Rotate the Neon database password (highest priority)

Neon is internet-reachable, so the leaked `neondb_owner` password is a live door
into all client PII independent of the EC2 box.

1. Log in to the **Neon console** → your project → **Roles** (or **Settings →
   Roles**).
2. Select the `neondb_owner` role → **Reset password** → copy the new password.
3. Neon shows a new connection string. Copy the full `postgres://…` URL (it
   embeds the new password). Keep it for Step 3.
4. (Recommended) In **Branches/Computes**, confirm there are no unexpected active
   connections from IPs you don't recognize.

## Step 2 — Rotate the Gemini API key

1. Go to **Google AI Studio** (aistudio.google.com) → **Get API key**, or the
   **Google Cloud Console** → **APIs & Services → Credentials** if the key lives
   in a Cloud project.
2. **Delete / revoke** the old key (don't just create a new one — the old one
   must die).
3. **Create a new API key.** Copy it for Step 3.
4. While here, this is the moment to address the §7216 / DPA item: move OFF the
   free tier onto **Vertex AI / paid Gemini** terms that contractually prohibit
   training/retention, and execute the Google **Data Processing Agreement**
   (see `docs/compliance/section-7216-consent.md` §5). Do NOT send real PII on
   free-tier terms.

## Step 3 — Update the running server with the new secrets

SSH to the box and update the pm2 process env (the app reads `DATABASE_URL` +
`AI_API_KEY` from there):

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro

# Set the rotated values in THIS shell (no leading space hides them from history;
# better: type them interactively to keep them out of ~/.bash_history):
export DATABASE_URL='postgres://neondb_owner:<NEW_PASSWORD>@<host>/<db>?sslmode=require'
export AI_API_KEY='<NEW_GEMINI_KEY>'

pm2 restart taxflow --update-env
pm2 env 0 | grep -E 'DATABASE_URL|AI_API_KEY'   # confirm the new values are live
curl -s http://localhost:8080/api/healthz       # health check
```

## Step 4 — Move secrets out of the pm2 env into AWS Secrets Manager / SSM

So a future leak can't happen by inspecting the process env, and so rotation is
one place. See `docs/compliance/runbook-tls-s3-secrets.md` Runbook C for the
exact `aws ssm put-parameter --type SecureString` + IAM-policy + boot-load steps.

## Step 5 — Verify + document

- Confirm the app works end-to-end after restart (open the demo, load a client).
- Note the rotation date + who did it in the WISP incident log
  (`docs/compliance/WISP.md` §6) — even a self-inflicted exposure should be
  recorded for the §314.4(h) incident-response trail.
- Delete the leaked values from anywhere you can still reach them (old chat
  scrollback, notes).

## Definition of done

- [ ] Neon `neondb_owner` password rotated; old one dead
- [ ] Gemini API key revoked + reissued
- [ ] `pm2 restart taxflow --update-env` done; healthz green
- [ ] Secrets moved to SSM/Secrets Manager (Step 4)
- [ ] (For real PII) on Vertex/paid Gemini + signed DPA, off the free tier
- [ ] Rotation recorded in the WISP incident log
