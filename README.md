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
