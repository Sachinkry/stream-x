const DEFAULT_LIMIT = 10000;
const MAX_LIMIT = 10000;

export async function onRequestGet(context) {
  const { env, request } = context;
  const db = env.STREAM_DB;

  if (!db) {
    return json(
      {
        ok: false,
        error: "Missing D1 binding: STREAM_DB",
      },
      500,
    );
  }

  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const result = await db
    .prepare(
      `
        SELECT
          id,
          body,
          x_tweet_id,
          created_at_iso AS createdAt
        FROM posts
        WHERE is_stream = 1
        ORDER BY created_at_epoch_ms DESC
        LIMIT ?
      `,
    )
    .bind(limit)
    .all();

  return json({
    ok: true,
    entries: (result.results || []).map((row) => ({
      id: String(row.id),
      body: row.body,
      tweetId: row.x_tweet_id || null,
      createdAt: row.createdAt,
    })),
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
