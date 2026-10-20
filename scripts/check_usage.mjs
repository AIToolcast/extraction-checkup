import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { onRequest } from '../functions/api/tool-events.js';
import { createUsageTracker } from '../usage.mjs';

const ORIGIN = 'https://aitoolcast.com';
const today = () => new Date().toISOString().slice(0, 10);
const keys = ['day', 'tool', 'session', 'event', 'source', 'campaign', 'audience'];
const payload = (change = {}) => ({ tool: 'extraction-checkup', session: randomUUID(),
  event: 'arrival', source: 'direct', campaign: 'none', audience: 'reader', ...change });
const request = (body, { method = 'POST', origin = ORIGIN, url = `${ORIGIN}/api/tool-events`, headers = {}, cf } = {}) => {
  const req = new Request(url, { method,
    headers: { 'Content-Type': 'application/json', ...(origin === null ? {} : { Origin: origin }), ...headers },
    ...(['GET', 'HEAD'].includes(method) ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  if (cf) Object.defineProperty(req, 'cf', { value: cf });
  return req;
};

class MockD1 {
  rows = [];
  statements = [];
  fail = false;
  prepare(sql) {
    return { bind: (...values) => ({ run: async () => {
      if (this.fail) throw new Error('unavailable');
      this.statements.push({ sql, values });
      if (sql.startsWith('INSERT OR IGNORE INTO tool_events')) {
        assert.match(sql, /COUNT\(\*\).*WHERE day = \?1\) < 5000/s);
        assert.match(sql, /event = \?8 AND source = \?5 AND campaign = \?6 AND audience = \?7/);
        assert.match(sql, /AND NOT EXISTS/);
        const row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
        const prior = values[7];
        const same = item => item.day === row.day && item.tool === row.tool && item.session === row.session;
        const dimensions = item => item.source === row.source && item.campaign === row.campaign && item.audience === row.audience;
        const insert = this.rows.filter(item => item.day === row.day).length < 5000
          && !this.rows.some(item => same(item) && item.event === row.event)
          && (!prior || this.rows.some(item => same(item) && item.event === prior && dimensions(item)))
          && !this.rows.some(item => same(item) && !dimensions(item));
        if (insert) this.rows.push(row);
        return { success: true, meta: { changes: Number(insert) } };
      }
      assert.match(sql, /^DELETE FROM tool_events/);
      assert.match(sql, /WHERE day < \?1 ORDER BY day LIMIT 1000/);
      const expired = this.rows.filter(row => row.day < values[0]).sort((a, b) => a.day.localeCompare(b.day)).slice(0, 1000);
      this.rows = this.rows.filter(row => !expired.includes(row));
      return { success: true, meta: { changes: expired.length } };
    } }) };
  }
}
const send = async (db, body, options) => onRequest({ request: request(body, options), env: { TOOL_USAGE: db } });
const browser = (change = {}) => {
  const calls = [];
  return { calls, location: { href: `${ORIGIN}/tools/extraction-checkup/` }, navigator: {},
    document: { referrer: '' }, crypto: { randomUUID },
    fetch: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return { ok: true }; },
    ...change };
};
const flush = async tracker => { await tracker.event('unknown'); await new Promise(resolve => setTimeout(resolve, 0)); };

test('endpoint stores only exact allowlisted fields and a server-derived day; no public data response', async () => {
  const db = new MockD1();
  const body = payload({ source: 'github', campaign: 'free-tool-launch' });
  const result = await send(db, body, { headers: { 'User-Agent': 'Example browser', Referer: `${ORIGIN}/private?secret=sentinel`, 'CF-Connecting-IP': '192.0.2.1' } });
  assert.equal(result.status, 204);
  assert.equal(await result.text(), '');
  assert.deepEqual(db.rows, [{ day: today(), ...body }]);
  assert.deepEqual(Object.keys(db.rows[0]), keys);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'), null);
  const get = await send(db, body, { method: 'GET' });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
  assert.equal(await get.text(), '');
});

test('rejects missing, extra and unsafe fields rather than persisting supplied data', async () => {
  for (const body of [null, [], 'null', '{', payload({ tool: 'other' }), payload({ session: 'person@example.com' }),
    payload({ session: randomUUID().replace('-4', '-1') }), payload({ source: 'https://example.com/private' }),
    payload({ campaign: 'private-query' }), payload({ event: 'pasted_json' }), payload({ audience: 'human' }),
    { ...payload(), text: 'PRIVATE INPUT' }, { ...payload(), day: '2026-01-01' },
    Object.fromEntries(Object.entries(payload()).filter(([key]) => key !== 'campaign'))]) {
    const db = new MockD1();
    assert.equal((await send(db, body)).status, 400, JSON.stringify(body));
    assert.deepEqual(db.statements, []);
  }
});

test('requires exact production Origin and target, JSON, and POST', async () => {
  const db = new MockD1();
  for (const origin of [null, 'null', 'http://aitoolcast.com', 'https://www.aitoolcast.com', 'https://aitoolcast.com.evil.example', 'https://preview.pages.dev']) {
    assert.equal((await send(db, payload(), { origin })).status, 403);
  }
  assert.equal((await send(db, payload(), { url: 'https://preview.pages.dev/api/tool-events' })).status, 403);
  assert.equal((await send(db, payload(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await send(db, payload(), { method: 'OPTIONS' })).status, 405);
  assert.deepEqual(db.statements, []);
});

test('body byte limit checks declared and actual streaming lengths, including UTF-8', async () => {
  const db = new MockD1();
  assert.equal((await send(db, ' '.repeat(2049))).status, 413);
  assert.equal((await send(db, payload(), { headers: { 'Content-Length': '2049' } })).status, 413);
  assert.equal((await send(db, 'é'.repeat(1025), { headers: { 'Content-Length': '1' } })).status, 413);
  let canceled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1025)); },
    cancel() { canceled = true; }
  });
  const req = new Request(`${ORIGIN}/api/tool-events`, { method: 'POST', body: stream,
    duplex: 'half', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' } });
  assert.equal((await onRequest({ request: req, env: { TOOL_USAGE: db } })).status, 413);
  assert.equal(canceled, true);
  assert.deepEqual(db.statements, []);
});

test('server honors privacy preferences and filters known bot signals without storing them', async () => {
  for (const options of [{ headers: { DNT: '1' } }, { headers: { 'Sec-GPC': '1' } },
    { headers: { 'User-Agent': 'Googlebot/2.1' } }, { headers: { 'User-Agent': 'Mozilla/5.0 HeadlessChrome/1' } },
    { cf: { botManagement: { verifiedBot: true } } }, { cf: { client: { bot: true } } }]) {
    const db = new MockD1();
    assert.equal((await send(db, payload(), options)).status, 204);
    assert.deepEqual(db.statements, []);
  }
  const db = new MockD1();
  assert.equal((await send(db, payload())).status, 204); // Missing signals are eligible, never verified people.
  assert.equal(db.rows.length, 1);
});

test('D1 is fail-closed and transient errors disclose no data', async () => {
  assert.equal((await onRequest({ request: request(payload()), env: {} })).status, 503);
  const db = new MockD1(); db.fail = true;
  const response = await send(db, payload());
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '');
  assert.deepEqual(db.rows, []);
});

test('dedupes tab events and enforces start/completion/output ordering and fixed dimensions', async () => {
  const db = new MockD1(); const body = payload();
  for (const event of ['complete', 'copy', 'export', 'start']) await send(db, { ...body, event });
  assert.equal(db.rows.length, 0);
  for (const event of ['arrival', 'arrival', 'start', 'start', 'complete', 'complete', 'copy', 'copy', 'export', 'practice_download']) {
    await send(db, { ...body, event });
  }
  assert.deepEqual(db.rows.map(row => row.event), ['arrival', 'start', 'complete', 'copy', 'export', 'practice_download']);
  await send(db, { ...body, event: 'practice_download', source: 'x', audience: 'qa' });
  assert.equal(db.rows.length, 6);
  const qa = payload({ audience: 'qa' });
  await send(db, qa); await send(db, { ...qa, event: 'start' });
  assert.equal(db.rows.filter(row => row.audience === 'reader').length, 6);
  assert.equal(db.rows.filter(row => row.audience === 'qa').length, 2);
});

test('daily cap counts unique rows across reader/QA; expiration is bounded and uses dates only', async () => {
  const db = new MockD1();
  db.rows = Array.from({ length: 5000 }, () => ({ day: today(), ...payload() }));
  const { day: _day, ...first } = db.rows[0];
  await send(db, first); await send(db, payload()); await send(db, payload({ audience: 'qa' }));
  assert.equal(db.rows.length, 5000);
  db.rows.push(...Array.from({ length: 1001 }, () => ({ day: '2000-01-01', ...payload() })));
  await send(db, first);
  assert.equal(db.rows.length, 5001);
  const deleteStatement = db.statements.at(-1);
  assert.deepEqual(deleteStatement.values, [new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10)]);
  await send(db, first);
  assert.equal(db.rows.length, 5000);
});

test('real SQLite accepts schema and endpoint statements, constraints, cap and sequencing', async () => {
  const db = new MockD1(); const body = payload();
  for (const event of ['arrival', 'start', 'complete', 'copy', 'export']) await send(db, { ...body, event });
  const schema = readFileSync(new URL('./usage-schema.sql', import.meta.url), 'utf8');
  const code = `import json, sqlite3, sys
data = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.executescript(data['schema'])
statements = data['statements']
insert = statements[0]['sql']
base = statements[0]['values']
wrong = base[:]; wrong[3] = 'complete'; wrong[7] = 'start'
db.execute(insert, wrong)
assert db.execute('SELECT COUNT(*) FROM tool_events').fetchone()[0] == 0
for statement in statements: db.execute(statement['sql'], statement['values'])
assert db.execute('SELECT COUNT(*) FROM tool_events').fetchone()[0] == 5
for statement in statements: db.execute(statement['sql'], statement['values'])
assert db.execute('SELECT COUNT(*) FROM tool_events').fetchone()[0] == 5
qa = base[:]; qa[2] = '00000000-0000-4000-8000-000000000000'; qa[6] = 'qa'
db.execute(insert, qa)
assert db.execute("SELECT COUNT(*) FROM tool_events WHERE audience = 'reader'").fetchone()[0] == 5
try:
 db.execute("INSERT INTO tool_events VALUES ('2026-10-20', 'other', '123456789012345678901234567890123456', 'arrival', 'direct', 'none', 'reader')")
 raise AssertionError('unsafe tool accepted')
except sqlite3.IntegrityError: pass
for i in range(5001):
 row = base[:]; row[2] = f'{i:08x}-0000-4000-8000-000000000001'
 db.execute(insert, row)
assert db.execute('SELECT COUNT(*) FROM tool_events').fetchone()[0] == 5000
print('SQLite schema and conditional writes verified')
`;
  const result = spawnSync('python', ['-c', code], { input: JSON.stringify({ schema, statements: db.statements }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('client sends only fixed payload fields, categories and same-origin credential-free requests', async () => {
  const tab = browser({ location: { href: `${ORIGIN}/tools/extraction-checkup/?utm_source=x&utm_campaign=free-tool-launch&private=DO-NOT-SEND` },
    document: { referrer: 'https://github.com/private?secret=DO-NOT-SEND' } });
  const tracker = createUsageTracker({ browser: tab });
  await tracker.event('start', { pasted: 'DO-NOT-SEND', sample: false });
  await tracker.event('complete', { report: 'DO-NOT-SEND' });
  await tracker.event('copy'); await tracker.event('export'); await tracker.event('practice_download');
  assert.deepEqual(tab.calls.map(call => call.body.event), ['arrival', 'start', 'complete', 'copy', 'export', 'practice_download']);
  assert.equal(new Set(tab.calls.map(call => call.body.session)).size, 1);
  for (const call of tab.calls) {
    assert.deepEqual(Object.keys(call.body), keys.slice(1));
    assert.deepEqual({ source: call.body.source, campaign: call.body.campaign, audience: call.body.audience },
      { source: 'x', campaign: 'free-tool-launch', audience: 'reader' });
    assert.equal(call.url, '/api/tool-events');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.mode, 'same-origin');
    assert.equal(JSON.stringify(call).includes('DO-NOT-SEND'), false);
  }
});

test('client excludes samples, invalid sequences, repeated events and failed input completions by caller contract', async () => {
  const tab = browser(); const tracker = createUsageTracker({ browser: tab });
  await tracker.event('complete'); await tracker.event('copy'); await tracker.event('export');
  for (const event of ['start', 'complete', 'copy', 'export', 'practice_download']) await tracker.event(event, { sample: true });
  assert.deepEqual(tab.calls.map(call => call.body.event), ['arrival']);
  await tracker.event('start'); await tracker.event('start');
  assert.deepEqual(tab.calls.map(call => call.body.event), ['arrival', 'start']);
  await tracker.event('complete'); await tracker.event('complete'); await tracker.event('copy'); await tracker.event('copy');
  assert.deepEqual(tab.calls.map(call => call.body.event), ['arrival', 'start', 'complete', 'copy']);
});

test('client disables localhost, previews, qa=1, DNT and GPC without creating an ID or touching storage', async () => {
  for (const change of [{ location: { href: 'http://localhost:8000/tools/extraction-checkup/' } },
    { location: { href: 'https://hash.aitoolcast.pages.dev/tools/extraction-checkup/' } },
    { location: { href: `${ORIGIN}/tools/extraction-checkup/?qa=1&tracking_test=1` } },
    { navigator: { doNotTrack: '1' } }, { navigator: { globalPrivacyControl: true } }, { doNotTrack: '1' }]) {
    const tab = browser({ ...change, crypto: { randomUUID() { throw new Error('must not identify opted-out tab'); } } });
    Object.defineProperty(tab, 'localStorage', { get() { throw new Error('storage must not be accessed'); } });
    Object.defineProperty(tab, 'sessionStorage', { get() { throw new Error('storage must not be accessed'); } });
    const tracker = createUsageTracker({ browser: tab });
    await tracker.event('start'); await flush(tracker);
    assert.equal(tab.calls.length, 0);
  }
  const tab = browser({ crypto: {} });
  await createUsageTracker({ browser: tab }).event('start');
  assert.equal(tab.calls.length, 0);
});

test('live tracking_test=1 marks QA and all attribution remains conservative fixed categories', async () => {
  const cases = [
    ['?tracking_test=1&utm_source=github&utm_campaign=newsroom', '', 'github', 'newsroom', 'qa'],
    ['?utm_source=unknown-private&utm_campaign=unknown-private', '', 'other', 'none', 'reader'],
    ['', 'https://github.com/AIToolcast/example', 'github', 'none', 'reader'],
    ['', 'https://t.co/private', 'x', 'none', 'reader'],
    ['', 'https://www.google.com/search?q=private', 'google', 'none', 'reader'],
    ['', 'https://www.bing.com/search?q=private', 'bing', 'none', 'reader'],
    ['', `${ORIGIN}/article/private`, 'direct', 'none', 'reader'],
    ['', 'https://github.com.evil.example/private', 'other', 'none', 'reader'],
    ['', '', 'direct', 'none', 'reader']
  ];
  for (const [query, referrer, source, campaign, audience] of cases) {
    const tab = browser({ location: { href: `${ORIGIN}/tools/extraction-checkup/${query}` }, document: { referrer } });
    const tracker = createUsageTracker({ browser: tab }); await flush(tracker);
    assert.deepEqual({ source: tab.calls[0].body.source, campaign: tab.calls[0].body.campaign, audience: tab.calls[0].body.audience }, { source, campaign, audience });
  }
});

test('client uses new IDs for new tabs and after UTC rollover without cross-session return counts', async () => {
  let date = '2026-10-20T23:59:00Z';
  const Clock = class extends Date { constructor() { super(date); } };
  const tab = browser({ Date: Clock }); const tracker = createUsageTracker({ browser: tab });
  await tracker.event('start'); await tracker.event('complete');
  date = '2026-10-21T00:01:00Z';
  await tracker.event('complete'); await tracker.event('start'); await tracker.event('complete');
  assert.deepEqual(tab.calls.map(call => call.body.event), ['arrival', 'start', 'complete', 'arrival', 'start', 'complete']);
  assert.notEqual(tab.calls[0].body.session, tab.calls[3].body.session);
  const second = browser(); const other = createUsageTracker({ browser: second }); await flush(other);
  assert.notEqual(tab.calls[0].body.session, second.calls[0].body.session);
});

test('client errors do not block the tool, retry or leak payloads, and opt-out can change mid-tab', async () => {
  const tab = browser({ fetch: async () => { throw new Error('offline'); } });
  const tracker = createUsageTracker({ browser: tab });
  assert.equal(await tracker.event('start'), false);
  assert.equal(await tracker.event('complete'), false);
  assert.equal(await tracker.event('copy'), false);
  const later = browser(); const tracking = createUsageTracker({ browser: later }); await flush(tracking);
  later.navigator.globalPrivacyControl = true;
  assert.equal(await tracking.event('start'), false);
  assert.equal(later.calls.length, 1);
});
