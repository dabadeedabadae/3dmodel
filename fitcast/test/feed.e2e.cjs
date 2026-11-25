const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

/**
 * Recommendations end to end: NestJS (built dist/) + the real Python recommendation-service
 * (RECOMMENDATION_SERVICE_URL, e.g. the docker container on :8010) + a local Open-Meteo mock: +8 °C and rain all day.
 * Checks the occasion rules through the whole chain, feedback (a disliked outfit is not shown again) and saved outfits.
 */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DAY = 24 * 3600_000;
const hourIso = (ms) => new Date(ms).toISOString().slice(0, 16);

function mockOpenMeteo() {
  const start = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const hours = Array.from({ length: 16 * 24 }, (_, i) => start + i * 3600_000);
  const days = Array.from({ length: 16 }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (url.pathname === '/geo') return res.end(JSON.stringify({ results: [{ name: 'Testville', country: 'Testland', latitude: 10, longitude: 20, timezone: 'UTC' }] }));
    res.end(JSON.stringify({
      utc_offset_seconds: 0,
      current: { time: hourIso(Date.now()), temperature_2m: 8, weather_code: 63 },
      hourly: { time: hours.map(hourIso), temperature_2m: hours.map(() => 8), weather_code: hours.map(() => 63) },
      daily: { time: days, weather_code: days.map(() => 63), temperature_2m_max: days.map(() => 10), temperature_2m_min: days.map(() => 5), precipitation_probability_max: days.map(() => 80) },
    }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('the swipe feed: up to 10 unseen outfits, a purchase suggestion, learned taste, the men filter', async () => {
  const serviceUrl = process.env.RECOMMENDATION_SERVICE_URL;
  assert.ok(serviceUrl, 'RECOMMENDATION_SERVICE_URL must point at a running recommendation-service');
  const mock = await mockOpenMeteo();
  const server = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: '3106', OPEN_METEO_GEOCODING_URL: `http://127.0.0.1:${mock.port}/geo`, OPEN_METEO_FORECAST_URL: `http://127.0.0.1:${mock.port}/forecast` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  server.stdout.on('data', (c) => { out += c; });
  server.stderr.on('data', (c) => { out += c; });
  const base = 'http://127.0.0.1:3106';
  const prisma = new PrismaClient();
  const email = `feed-${randomUUID()}@example.com`;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (server.exitCode !== null) throw new Error(out);
      try { ready = (await fetch(base + '/outfits')).status === 401; } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, out);
    const reg = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: randomUUID() }) });
    const token = (await reg.json()).accessToken;
    const json = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const send = (method, path, body) => fetch(base + path, { method, headers: json, body: JSON.stringify(body) });
    await send('PATCH', '/users/me', { city: 'Testville' });
    const add = async (type, dominantColor) => {
      const f = new FormData();
      Object.entries({ type, dominantColor, fitTag: 'GOOD' }).forEach(([k, v]) => f.append(k, v));
      f.append('image', new Blob([PNG], { type: 'image/png' }), 'x.png');
      const r = await fetch(base + '/wardrobe', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f });
      assert.equal(r.status, 201, await r.clone().text());
      return (await r.json()).id;
    };
    // no shoes: every outfit is missing them, so each one gets a suggestion
    for (const [t, c] of [['TSHIRT', 'white'], ['TSHIRT', 'navy'], ['SWEATER', 'gray'], ['JEANS', 'blue'], ['PANTS', 'black'],
      ['SKIRT', 'beige'], ['JACKET', 'black'], ['COAT', 'beige'], ['CARDIGAN', 'gray']]) await add(t, c);

    assert.equal((await send('POST', '/recommendations', { eventType: 'CASUAL', wear: 'kids' })).status, 400);
    const f1 = await (await send('POST', '/recommendations', { eventType: 'CASUAL', feed: true })).json();
    assert.equal(f1.status, 'OK');
    assert.ok(f1.outfits.length > 5 && f1.outfits.length <= 10, String(f1.outfits.length));
    assert.equal(f1.taste.votes, 0);
    for (const o of f1.outfits) {
      assert.ok(o.suggestion, 'an outfit without shoes gets a suggestion');
      // shoes complete it, unless replacing an item lifts the score more
      assert.ok(o.suggestion.type === 'SHOES' || o.suggestion.gain >= 3, JSON.stringify(o.suggestion));
      assert.ok(o.suggestion.reason.length > 5);
      // a cardigan is a layer: never the only top
      const types = o.items.map((i) => i.type);
      if (types.includes('CARDIGAN')) assert.ok(types.some((t) => ['TSHIRT', 'SWEATER'].includes(t)), types.join());
    }

    // swipe: like the outfits with jeans, dislike the rest
    const ctx = f1.context;
    for (const o of f1.outfits) {
      const verdict = o.items.some((i) => i.type === 'JEANS') ? 'LIKE' : 'DISLIKE';
      const r = await send('PUT', '/recommendations/feedback', { itemIds: o.items.map((i) => i.id), eventType: 'CASUAL',
        temperatureC: ctx.weather.temperatureC, precipitation: ctx.weather.precipitation, score: o.score, verdict });
      assert.equal(r.status, 200);
    }
    const f2 = await (await send('POST', '/recommendations', { eventType: 'CASUAL', feed: true })).json();
    assert.equal(f2.taste.votes, f1.outfits.length);
    assert.ok(f2.taste.types.JEANS > 0, JSON.stringify(f2.taste));
    const seen = new Set(f1.outfits.map((o) => o.key));
    assert.ok(f2.outfits.every((o) => !seen.has(o.key)), 'swiped outfits are not shown again');
    if (f2.outfits.length) assert.ok(f2.outfits.some((o) => typeof o.breakdown.taste === 'number'));
    // I-79: every outfit carries its style factors, and with 8+ swipes of both kinds a personal model is trained
    assert.equal(f1.tasteModel, null);
    assert.ok(f1.outfits.every((o) => Array.isArray(o.breakdown.factors)));
    const verdictsGiven = f1.outfits.map((o) => o.items.some((i) => i.type === 'JEANS'));
    if (verdictsGiven.length >= 8 && verdictsGiven.filter(Boolean).length >= 2 && verdictsGiven.filter((v) => !v).length >= 2) {
      assert.equal(f2.tasteModel.examples, f1.outfits.length, JSON.stringify(f2.tasteModel));
      assert.ok(f2.tasteModel.prefers.length + f2.tasteModel.avoids.length > 0);
    }

    // attributes read from the photo (I-77): stored when valid, rejected otherwise
    const withAttrs = async (attributes) => {
      const f = new FormData();
      Object.entries({ type: 'SHIRT', dominantColor: 'white', fitTag: 'GOOD', attributes }).forEach(([k, v]) => f.append(k, v));
      f.append('image', new Blob([PNG], { type: 'image/png' }), 'x.png');
      return fetch(base + '/wardrobe', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: f });
    };
    const good = await withAttrs(JSON.stringify({ pattern: 'pattern', secondaryColor: 'navy', sleeve: 'long', tone: 'light' }));
    assert.equal(good.status, 201, await good.clone().text());
    assert.deepEqual((await good.json()).attributes, { pattern: 'pattern', secondaryColor: 'navy', sleeve: 'long', tone: 'light' });
    assert.equal((await withAttrs(JSON.stringify({ pattern: 'paisley' }))).status, 400);
    assert.equal((await withAttrs(JSON.stringify({ secondaryColor: 'teal' }))).status, 400);
    assert.equal((await withAttrs(JSON.stringify({ hacked: true }))).status, 400);
    assert.equal((await withAttrs('not json')).status, 400);
    // the engine takes them: the feed still answers with the patterned shirt in the wardrobe
    assert.equal((await send('POST', '/recommendations', { eventType: 'BUSINESS', feed: true })).status, 200);

    // the men filter: no skirts
    const men = await (await send('POST', '/recommendations', { eventType: 'DATE', feed: true, wear: 'men' })).json();
    for (const o of men.outfits) assert.ok(!o.items.some((i) => i.type === 'SKIRT'));
  } finally {
    server.kill();
    mock.server.close();
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});
