const ORIGIN = 'https://aitoolcast.com';
const EVENTS = new Set(['arrival', 'start', 'complete', 'copy', 'export', 'practice_download']);
const SOURCES = new Set(['x', 'github', 'google', 'bing']);
const CAMPAIGNS = new Set(['free-tool-launch', 'newsroom']);

function sourceFor(url, referrer) {
  const tagged = url.searchParams.get('utm_source');
  if (tagged) return SOURCES.has(tagged) ? tagged : 'other';
  if (!referrer) return 'direct';
  try {
    const from = new URL(referrer);
    if (from.origin === ORIGIN) return 'direct';
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 't.co'].includes(from.hostname)) return 'x';
    if (['github.com', 'www.github.com'].includes(from.hostname)) return 'github';
    if (['google.com', 'www.google.com'].includes(from.hostname)) return 'google';
    if (['bing.com', 'www.bing.com'].includes(from.hostname)) return 'bing';
  } catch { /* Only a fixed category is sent, even for a malformed referrer. */ }
  return 'other';
}

/** Optional anonymous counts; no storage, cookies, input, reports or raw URLs. */
export function createUsageTracker({ tool = 'extraction-checkup', browser = globalThis } = {}) {
  const disabled = { event: async () => false };
  const optedOut = () => browser.navigator?.globalPrivacyControl === true
    || browser.navigator?.doNotTrack === '1' || browser.doNotTrack === '1'
    || browser.navigator?.msDoNotTrack === '1';
  let url;
  try { url = new URL(browser.location.href); } catch { return disabled; }
  if (tool !== 'extraction-checkup' || url.origin !== ORIGIN || url.searchParams.get('qa') === '1'
      || optedOut() || typeof browser.crypto?.randomUUID !== 'function' || typeof browser.fetch !== 'function') return disabled;
  const source = sourceFor(url, browser.document?.referrer);
  const taggedCampaign = url.searchParams.get('utm_campaign');
  const campaign = CAMPAIGNS.has(taggedCampaign) ? taggedCampaign : 'none';
  const audience = url.searchParams.get('tracking_test') === '1' ? 'qa' : 'reader';
  const today = () => new (browser.Date || Date)().toISOString().slice(0, 10);
  let day = today();
  let session = browser.crypto.randomUUID();
  const sent = new Set();
  let pending = Promise.resolve();

  function enqueue(name) {
    sent.add(name);
    const payload = { tool, session, event: name, source, campaign, audience };
    // Ordered sends preserve arrival/start/complete dependencies. Failure loses
    // this optional count, never tool functionality, and is never retried.
    pending = pending.then(async () => {
      if (optedOut()) return false;
      try {
        const result = await browser.fetch('/api/tool-events', {
          method: 'POST', credentials: 'omit', mode: 'same-origin', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), keepalive: true
        });
        return result.ok;
      } catch { return false; }
    });
    return pending;
  }

  function event(name, options = {}) {
    if (!EVENTS.has(name) || options?.sample === true || optedOut()) return Promise.resolve(false);
    if (today() !== day) {
      day = today();
      session = browser.crypto.randomUUID();
      sent.clear();
      enqueue('arrival');
    }
    if (sent.has(name) || (name === 'complete' && !sent.has('start'))
        || (['copy', 'export'].includes(name) && !sent.has('complete'))) return Promise.resolve(false);
    return enqueue(name);
  }
  enqueue('arrival');
  return { event };
}
