# sachinkry

A static single-column thought stream built for GitHub Pages.

## Structure

- `index.html` renders the shell of the site.
- `styles.css` contains the editorial one-column styling.
- `script.js` loads and renders markdown entries from the repo.
- `content/manifest.json` lists the markdown files to load.
- `content/YYYY/MM.md` stores entries for each month.

## Entry format

Add entries to a monthly markdown file using this structure:

```md
---
date: 2026-04-05T20:30:00+05:30
---
Your thought goes here. Multiple paragraphs are supported.

===

---
date: 2026-04-05T22:00:00+05:30
---
Another thought without a link.
```

Notes:

- `date` is required and should be in ISO 8601 format.
- Separate entries with `===` on its own line.
- Add new monthly files to `content/manifest.json` so the site can fetch them.

## GitHub Pages

1. Push this directory to a GitHub repository.
2. In GitHub, open repository `Settings` -> `Pages`.
3. Set the source to deploy from your default branch root.
4. Wait for Pages to publish the static files.

## Publishing workflow

This version is intentionally repo-driven:

1. Open the current monthly markdown file.
2. Append a new entry using the format above.
3. Commit and push the change.
4. GitHub Pages will publish the updated stream.

## Telegram publishing

You can also publish from Telegram with `/stream your thought here`.

### How it works

- GitHub Actions polls your Telegram bot every 5 minutes.
- New `/stream ...` messages from your allowed chat are appended to `content/YYYY/MM.md`.
- The workflow also updates `.stream-state/telegram.json` so Telegram updates are not processed twice.
- After the commit lands, GitHub Pages will publish the new entry.

### Files added for this

- `.github/workflows/telegram-stream.yml`
- `scripts/telegram-stream.mjs`
- `.stream-state/telegram.json`

### One-time setup

1. Create a Telegram bot with `@BotFather`.
2. Save the bot token.
3. Send at least one message to your bot from Telegram.
4. Find your personal chat ID.
5. In your GitHub repository, add these Actions secrets:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ALLOWED_CHAT_ID`
6. Enable GitHub Actions for the repository.
7. Run the `Telegram Stream` workflow once manually from the Actions tab.

### Bot commands

In `@BotFather`, set the bot command list to:

```text
stream - Publish a thought to the stream
help - Show usage
```

### Usage

Send:

```text
/stream The interface should feel like a notebook, not a dashboard.
```

Or multi-line:

```text
/stream The archive matters because it slows the thought down.

Publishing should leave a visible trail.
```

### Notes

- This is near-real-time, not instant. Scheduled GitHub Actions usually run every 5 minutes, but GitHub can delay them.
- Only the chat ID in `TELEGRAM_ALLOWED_CHAT_ID` is allowed to publish.
- Telegram messages are timestamped into the archive using `Asia/Kolkata`.
- If you create a new month file automatically through Telegram, the script also adds it to `content/manifest.json`.

## Realtime Telegram mode on Cloudflare

If you want `/stream` to appear within seconds on `https://stream-x.pages.dev/`, use the Cloudflare webhook path in this repo.

### What this adds

- `functions/api/telegram-webhook.js` receives Telegram webhook events in realtime
- `functions/api/stream.js` serves live posts from D1
- `schema.sql` defines the D1 table
- `script.js` now prefers the live API and falls back to the markdown archive if the API is unavailable

### Cloudflare setup

1. In Cloudflare, open `Workers & Pages` -> `D1 SQL database` -> `stream-x`.
2. Confirm the database id is:
   - `0da50caf-20b9-458c-9663-38e54b836552`
3. In your Pages project, bind that database with this exact binding name:
   - `STREAM_DB`
4. In your Pages project secrets, set:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ALLOWED_CHAT_ID`
   - `TELEGRAM_WEBHOOK_SECRET`
   - optional: `STREAM_TIMEZONE` with value `Asia/Kolkata`
5. Apply `schema.sql` to the D1 database.

### Bind the D1 database to the Pages project

1. Open `Cloudflare Dashboard`
2. Open `Workers & Pages`
3. Open your Pages project `stream-x`
4. Open `Settings`
5. Open `Bindings`
6. Click `Add binding`
7. Choose `D1 database`
8. Set:
   - Variable name: `STREAM_DB`
   - D1 database: `stream-x`
9. Save and redeploy

### Apply the schema

Using Wrangler:

```bash
npx wrangler d1 execute stream-x --remote --file schema.sql
```

Using the Cloudflare dashboard:

1. Open `Workers & Pages` -> `D1 SQL database` -> `stream-x`
2. Open `Console`
3. Paste the contents of `schema.sql`
4. Run the query

### Exact webhook command

Replace the placeholders and run:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://stream-x.pages.dev/api/telegram-webhook" \
  -d "secret_token=<YOUR_TELEGRAM_WEBHOOK_SECRET>"
```

### Verify the webhook

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
```

### Test publishing

Send this to your bot in Telegram:

```text
/stream This should appear on the site in a few seconds.
```

Then verify:

```bash
curl https://stream-x.pages.dev/api/stream
```

### Important limitation

Telegram webhook mode and Telegram `getUpdates` polling mode cannot be active at the same time for the same bot.

That means:

- the Cloudflare realtime mode is the primary mode
- the GitHub 5-minute polling workflow remains in the repo as a fallback/manual mode
- if you enable the webhook, do not expect the polling workflow to ingest the same bot simultaneously
