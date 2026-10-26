const ORIGIN = 'https://aitoolcast.com';
const EVENTS = ['arrival', 'start', 'complete', 'copy', 'export', 'practice_download'];
const SOURCES = ['direct', 'x', 'github', 'google', 'bing', 'other', 'nouploadtools', 'supatools'];
const CAMPAIGNS = ['none', 'free-tool-launch', 'newsroom'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY'
};
const reply = status => new Response(null, { status, headers: {
  ...HEADERS, ...(status === 405 ? { Allow: 'POST' } : {})
} });

async function readBody(request) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 2048)) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function valid(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = ['tool', 'session', 'event', 'source', 'campaign', 'audience'];
  return Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key))
    && body.tool === 'extraction-checkup' && typeof body.session === 'string' && UUID.test(body.session)
    && EVENTS.includes(body.event) && SOURCES.includes(body.source)
    && CAMPAIGNS.includes(body.campaign) && ['reader', 'qa'].includes(body.audience);
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405);
  if (new URL(request.url).origin !== ORIGIN || request.headers.get('origin') !== ORIGIN) return reply(403);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415);
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return reply(204);

  // These transient signals only exclude obvious bots. Their absence never proves a person.
  if (request.cf?.botManagement?.verifiedBot || request.cf?.client?.bot
      || /bot\b|crawler|spider|headless|slurp|bingpreview|google-inspectiontool|curl\/|wget\/|python-requests/i.test(request.headers.get('user-agent') || '')) {
    return reply(204);
  }
  let body;
  try {
    const text = await readBody(request);
    if (text === null) return reply(413);
    body = JSON.parse(text);
  } catch { return reply(400); }
  if (!valid(body)) return reply(400);
  if (!env?.TOOL_USAGE?.prepare) return reply(503);

  const day = new Date().toISOString().slice(0, 10);
  const oldest = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
  const prior = body.event === 'complete' ? 'start'
    : ['copy', 'export'].includes(body.event) ? 'complete'
      : body.event === 'start' ? 'arrival' : null;
  try {
    // One atomic statement covers concurrent dedupe/cap checks. Dimensions must
    // stay consistent within a session; every value is bound, never interpolated.
    await env.TOOL_USAGE.prepare(`INSERT OR IGNORE INTO tool_events
      (day, tool, session, event, source, campaign, audience)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
      WHERE (SELECT COUNT(*) FROM tool_events WHERE day = ?1) < 5000
      AND (?8 IS NULL OR EXISTS (
        SELECT 1 FROM tool_events WHERE day = ?1 AND tool = ?2 AND session = ?3
          AND event = ?8 AND source = ?5 AND campaign = ?6 AND audience = ?7))
      AND NOT EXISTS (
        SELECT 1 FROM tool_events WHERE day = ?1 AND tool = ?2 AND session = ?3
          AND (source != ?5 OR campaign != ?6 OR audience != ?7))`)
      .bind(day, body.tool, body.session, body.event, body.source, body.campaign, body.audience, prior).run();
    // ponytail: activity-driven cleanup is bounded; the reporting run must also
    // drain expired rows during quiet periods. Queries exclude expired dates.
    await env.TOOL_USAGE.prepare(`DELETE FROM tool_events WHERE (day, tool, session, event) IN (
      SELECT day, tool, session, event FROM tool_events WHERE day < ?1 ORDER BY day LIMIT 1000)`)
      .bind(oldest).run();
    // Uniform response also covers duplicate, out-of-order and capped events.
    return reply(204);
  } catch { return reply(503); }
}
