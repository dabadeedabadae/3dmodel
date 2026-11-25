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

test('recommendations follow the occasion and the weather, feedback hides dislikes, outfits are saved per event', async () => {
  const serviceUrl = process.env.RECOMMENDATION_SERVICE_URL;
  assert.ok(serviceUrl, 'RECOMMENDATION_SERVICE_URL must point at a running recommendation-service');
  assert.equal((await fetch(serviceUrl.replace(/\/$/, '') + '/health')).status, 200, 'the recommendation-service is not running');
  const prisma = new PrismaClient();
  const mock = await mockOpenMeteo();
  const server = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: '3105', OPEN_METEO_GEOCODING_URL: `http://127.0.0.1:${mock.port}/geo`, OPEN_METEO_FORECAST_URL: `http://127.0.0.1:${mock.port}/forecast` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  server.stdout.on('data', (c) => { out += c; });
  server.stderr.on('data', (c) => { out += c; });
  const base = 'http://127.0.0.1:3105';
  const emails = [`rec-a-${randomUUID()}@example.com`, `rec-b-${randomUUID()}@example.com`];
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (server.exitCode !== null) throw new Error(out);
      try { ready = (await fetch(base + '/outfits')).status === 401; } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, out);
    const tokens = [];
    for (const email of emails) {
      const r = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: randomUUID() }) });
      tokens.push((await r.json()).accessToken);
    }
    const [a, b] = tokens;
    const json = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
    const send = (method, path, body, t = a) => fetch(base + path, { method, headers: json(t), body: JSON.stringify(body) });
    await send('PATCH', '/users/me', { city: 'Testville' });

    const add = async (type, dominantColor, fitTag = 'GOOD') => {
      const f = new FormData();
      Object.entries({ type, dominantColor, fitTag }).forEach(([k, v]) => f.append(k, v));
      f.append('image', new Blob([PNG], { type: 'image/png' }), 'x.png');
      const r = await fetch(base + '/wardrobe', { method: 'POST', headers: { Authorization: `Bearer ${a}` }, body: f });
      assert.equal(r.status, 201, await r.clone().text());
      return (await r.json()).id;
    };
    const ids = {
      shirt: await add('SHIRT', 'white'), shirt2: await add('SHIRT', 'blue'), hoodie: await add('HOODIE', 'red'),
      pants: await add('PANTS', 'gray'), jeans: await add('JEANS', 'blue'), shorts: await add('SHORTS', 'beige'),
      blazer: await add('BLAZER', 'navy'), coat: await add('COAT', 'beige'), cardigan: await add('CARDIGAN', 'gray', 'TIGHT'),
      shoesBlack: await add('SHOES', 'black'), shoesWhite: await add('SHOES', 'white'),
    };
    const typeOf = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));

    // ---- validation ----
    assert.equal((await send('POST', '/recommendations', {})).status, 400);
    assert.equal((await send('POST', '/recommendations', { eventType: 'PICNIC' })).status, 400);
    assert.equal((await fetch(base + '/recommendations', { method: 'POST' })).status, 401);

    // ---- an interview tomorrow: +8 °C, rain ----
    const startsAt = new Date(Date.now() + DAY).toISOString();
    const event = await (await send('POST', '/events', { title: 'Interview', eventType: 'INTERVIEW', startsAt })).json();
    assert.equal(event.weather.status, 'FORECAST');
    const r1 = await send('POST', '/recommendations', { eventId: event.id, limit: 5 });
    assert.equal(r1.status, 200, await r1.clone().text());
    const rec = await r1.json();
    assert.equal(rec.status, 'OK');
    assert.equal(rec.context.eventType, 'INTERVIEW');
    // I-79: the weather also carries the wind (null here: the stub forecast has none) and the local hour
    const { hour, ...weather } = rec.context.weather;
    assert.deepEqual(weather, { temperatureC: 8, precipitation: 'RAIN', description: 'Rain', windKph: null });
    assert.ok(Number.isInteger(hour) && hour >= 0 && hour <= 23, `hour ${hour}`);
    assert.ok(rec.outfits.length >= 1 && rec.outfits.length <= 5);
    assert.ok(rec.warnings.some((w) => w.includes('too tight')), 'the TIGHT cardigan is skipped');
    for (const o of rec.outfits) {
      const names = o.items.map((i) => typeOf[i.id]);
      assert.ok(!names.includes('hoodie') && !names.includes('shorts') && !names.includes('cardigan'), names.join());
      assert.ok(!names.includes('shoesWhite'), 'no light shoes in the rain');
      assert.ok(o.items[0].imageUrl.startsWith('/uploads/'));
      assert.match(o.explanation, /^Job interview, \+8 °C, rain: /);
      assert.equal(o.feedback, null);
    }
    const best = rec.outfits[0];
    assert.ok(best.items.some((i) => i.id === ids.blazer), 'a blazer for an interview: ' + best.explanation);
    assert.ok(best.items.some((i) => i.id === ids.coat), 'a coat against the rain: ' + best.explanation);

    // the other user cannot ask for this event
    assert.equal((await send('POST', '/recommendations', { eventId: event.id }, b)).status, 404);
    // an event beyond the forecast window has no recommendation yet
    const far = await (await send('POST', '/events', { title: 'Wedding', eventType: 'WEDDING_GUEST', startsAt: new Date(Date.now() + 40 * DAY).toISOString() })).json();
    assert.equal((await send('POST', '/recommendations', { eventId: far.id })).status, 409);

    // ---- an occasion without an event: current weather in the profile city ----
    const gym = await (await send('POST', '/recommendations', { eventType: 'GYM' })).json();
    for (const o of gym.outfits) assert.ok(!o.items.some((i) => ['shirt', 'shirt2', 'blazer', 'jeans'].includes(typeOf[i.id])));

    // ---- feedback: "doesn't fit" hides the outfit for this event ----
    const fb = (body, t = a) => send('PUT', '/recommendations/feedback', body, t);
    const ctx = { eventId: event.id, eventType: 'INTERVIEW', temperatureC: 8, precipitation: 'RAIN', score: best.score };
    assert.equal((await fb({ ...ctx, itemIds: best.items.map((i) => i.id), verdict: 'DISLIKE' }, b)).status, 404, 'not their items');
    assert.equal((await fb({ ...ctx, itemIds: best.items.map((i) => i.id), verdict: 'MAYBE' })).status, 400);
    const disliked = await fb({ ...ctx, itemIds: best.items.map((i) => i.id), verdict: 'DISLIKE' });
    assert.equal(disliked.status, 200, await disliked.clone().text());
    const second = rec.outfits[1];
    if (second) assert.equal((await fb({ ...ctx, itemIds: second.items.map((i) => i.id), verdict: 'LIKE' })).status, 200);
    const rec2 = await (await send('POST', '/recommendations', { eventId: event.id, limit: 5 })).json();
    assert.equal(rec2.hiddenDisliked, 1);
    assert.ok(!rec2.outfits.some((o) => o.key === best.key));
    if (second) assert.equal(rec2.outfits.find((o) => o.key === second.key)?.feedback, 'LIKE');
    // the same outfit for another occasion is not affected
    const rows = await prisma.outfitFeedback.findMany({ where: { user: { email: emails[0] } } });
    assert.ok(rows.every((r) => r.context === `event:${event.id}` && r.temperatureC === 8 && r.precipitation === 'RAIN'));
    // removing the verdict shows the outfit again
    await fb({ ...ctx, itemIds: best.items.map((i) => i.id), verdict: null });
    assert.equal((await (await send('POST', '/recommendations', { eventId: event.id, limit: 5 })).json()).hiddenDisliked, 0);

    // ---- saved outfits ----
    const save = (body, t = a) => send('POST', '/outfits', body, t);
    const outfitBody = { eventType: 'INTERVIEW', eventId: event.id, itemIds: best.items.map((i) => i.id), explanation: best.explanation };
    assert.equal((await save(outfitBody, b)).status, 404);
    const s1 = await save(outfitBody);
    assert.equal(s1.status, 201, await s1.clone().text());
    const saved = await s1.json();
    assert.equal(saved.event.id, event.id);
    assert.equal(saved.items.length, best.items.length);
    assert.equal((await (await save({ ...outfitBody, itemIds: [...outfitBody.itemIds].reverse() })).json()).id, saved.id, 'saving twice returns the same outfit');
    const rec3 = await (await send('POST', '/recommendations', { eventId: event.id, limit: 5 })).json();
    assert.equal(rec3.outfits.find((o) => o.key === best.key)?.savedOutfitId, saved.id);
    const profile = await (await fetch(base + '/users/me', { headers: json(a) })).json();
    assert.equal(profile._count.savedOutfits, 1);
    assert.deepEqual(await (await fetch(base + '/outfits', { headers: json(b) })).json(), []);
    // deleting the event keeps the outfit, without the event
    assert.equal((await fetch(base + '/events/' + event.id, { method: 'DELETE', headers: json(a) })).status, 200);
    const list = await (await fetch(base + '/outfits', { headers: json(a) })).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].event, null);
    assert.equal((await fetch(base + '/outfits/' + saved.id, { method: 'DELETE', headers: json(b) })).status, 404);
    assert.equal((await fetch(base + '/outfits/' + saved.id, { method: 'DELETE', headers: json(a) })).status, 200);
  } finally {
    server.kill();
    mock.server.close();
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const { rm } = require('node:fs/promises');
    const items = await prisma.wardrobeItem.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { imageUrl: true } });
    for (const i of items) await rm('.' + i.imageUrl, { force: true });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  }
});
