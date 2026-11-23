const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

/**
 * Events + weather. Open-Meteo is replaced by a local mock (OPEN_METEO_*_URL), so the test is deterministic and
 * sends nothing to the internet: Testville answers with a forecast (snow now, rain every hour), Nowhere is not
 * found, Brokentown is found but its forecast request fails.
 */
const DAY = 24 * 3600_000;
const hourIso = (ms) => new Date(ms).toISOString().slice(0, 16);

function mockOpenMeteo() {
  const start = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const hours = Array.from({ length: 16 * 24 }, (_, i) => start + i * 3600_000);
  const days = Array.from({ length: 16 }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
  const requests = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url.pathname + url.search);
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/geo') {
      const name = url.searchParams.get('name');
      if (name === 'Testville') return send(200, { results: [{ name: 'Testville', country: 'Testland', latitude: 10, longitude: 20, timezone: 'UTC' }] });
      if (name === 'Brokentown') return send(200, { results: [{ name: 'Brokentown', country: 'Testland', latitude: -5, longitude: -5, timezone: 'UTC' }] });
      return send(200, {});
    }
    if (url.pathname === '/forecast') {
      if (url.searchParams.get('latitude') === '-5') return send(500, { error: true });
      return send(200, {
        utc_offset_seconds: 0,
        current: { time: hourIso(Date.now()), temperature_2m: -2.04, weather_code: 73 },
        hourly: { time: hours.map(hourIso), temperature_2m: hours.map(() => 7.46), weather_code: hours.map(() => 63) },
        daily: { time: days, weather_code: days.map(() => 3), temperature_2m_max: days.map(() => 9), temperature_2m_min: days.map(() => 1), precipitation_probability_max: days.map(() => 40) },
      });
    }
    send(404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port })));
}

test('events are per-owner, validated, and carry the weather for their time and city', async () => {
  const prisma = new PrismaClient();
  const mock = await mockOpenMeteo();
  const server = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env, PORT: '3104',
      OPEN_METEO_GEOCODING_URL: `http://127.0.0.1:${mock.port}/geo`,
      OPEN_METEO_FORECAST_URL: `http://127.0.0.1:${mock.port}/forecast`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  server.stdout.on('data', (c) => { out += c; });
  server.stderr.on('data', (c) => { out += c; });
  const base = 'http://127.0.0.1:3104';
  const emails = [`events-a-${randomUUID()}@example.com`, `events-b-${randomUUID()}@example.com`];
  const password = randomUUID();
  const json = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (server.exitCode !== null) throw new Error(out);
      try { ready = (await fetch(base + '/events')).status === 401; } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, out);
    assert.equal((await fetch(base + '/weather')).status, 401);
    const tokens = [];
    for (const email of emails) {
      const r = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      assert.equal(r.status, 201);
      tokens.push((await r.json()).accessToken);
    }
    const [a, b] = tokens;
    const get = (path, t = a) => fetch(base + path, { headers: json(t) });
    const send = (method, path, body, t = a) => fetch(base + path, { method, headers: json(t), body: JSON.stringify(body) });

    // ---- weather ----
    assert.equal((await get('/weather')).status, 400, 'no city in the profile yet');
    assert.equal((await send('PATCH', '/users/me', { city: 'Testville' })).status, 200);
    const w = await get('/weather');
    assert.equal(w.status, 200, await w.clone().text());
    const weather = await w.json();
    assert.equal(weather.fromProfile, true);
    assert.equal(weather.location.name, 'Testville');
    assert.equal(weather.current.temperatureC, -2);
    assert.equal(weather.current.precipitation, 'SNOW');
    assert.equal(weather.current.description, 'Snow');
    assert.equal(weather.daily.length, 16);
    assert.deepEqual(weather.recommendationWeather, { temperatureC: -2, precipitation: 'SNOW' });
    assert.ok(!('hourly' in weather));
    assert.equal((await get('/weather?city=Nowhere')).status, 404);
    assert.equal((await get('/weather?city=Brokentown')).status, 503);
    assert.equal((await get('/weather?city=' + 'x'.repeat(101))).status, 400);
    // the profile's e-mail never goes to the weather provider
    assert.ok(mock.requests.every((r) => !r.includes('example.com')));

    // ---- validation ----
    const tomorrowNoon = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1, 12)).toISOString();
    const valid = { title: 'Team meeting', eventType: 'BUSINESS', startsAt: tomorrowNoon };
    assert.equal((await send('POST', '/events', { ...valid, title: '   ' })).status, 400);
    assert.equal((await send('POST', '/events', { ...valid, eventType: 'PICNIC' })).status, 400);
    assert.equal((await send('POST', '/events', { ...valid, startsAt: 'tomorrow' })).status, 400);
    assert.equal((await send('POST', '/events', { ...valid, startsAt: '1990-01-01T10:00:00Z' })).status, 400);
    assert.equal((await send('POST', '/events', { ...valid, title: 'x'.repeat(101) })).status, 400);
    assert.equal((await fetch(base + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid) })).status, 401);

    // ---- create with the forecast ----
    const created = await send('POST', '/events', { ...valid, userId: randomUUID(), note: '  bring slides ' });
    assert.equal(created.status, 201, await created.clone().text());
    const meeting = await created.json();
    assert.ok(!('userId' in meeting));
    assert.equal(meeting.note, 'bring slides');
    assert.equal(meeting.city, null);
    assert.equal(meeting.weather.status, 'FORECAST');
    assert.equal(meeting.weather.cityFromProfile, true);
    assert.equal(meeting.weather.location, 'Testville, Testland');
    assert.equal(meeting.weather.temperatureC, 7.5);
    assert.equal(meeting.weather.precipitation, 'RAIN');
    assert.deepEqual(meeting.weather.recommendationInput, { weather: { temperatureC: 7.5, precipitation: 'RAIN' }, eventType: 'BUSINESS' });

    const far = await (await send('POST', '/events', { title: 'Wedding', eventType: 'FORMAL', startsAt: new Date(Date.now() + 60 * DAY).toISOString() })).json();
    assert.equal(far.weather.status, 'TOO_FAR');
    assert.match(far.weather.forecastFrom, /^\d{4}-\d{2}-\d{2}$/);
    const lost = await (await send('POST', '/events', { ...valid, title: 'Trip', eventType: 'OUTDOOR', city: 'Nowhere' })).json();
    assert.equal(lost.weather.status, 'CITY_NOT_FOUND');
    assert.equal(lost.weather.cityFromProfile, false);
    const broken = await send('POST', '/events', { ...valid, title: 'Run', eventType: 'GYM', city: 'Brokentown' });
    assert.equal(broken.status, 201, 'the event is saved even when the weather is unavailable');
    assert.equal((await broken.json()).weather.status, 'UNAVAILABLE');
    const past = await (await send('POST', '/events', { title: 'Old party', eventType: 'CASUAL', startsAt: new Date(Date.now() - 2 * DAY).toISOString() })).json();

    // ---- lists ----
    const upcoming = await (await get('/events')).json();
    assert.deepEqual(upcoming.map((e) => e.title).sort(), ['Run', 'Team meeting', 'Trip', 'Wedding']);
    assert.equal(upcoming.at(-1).title, 'Wedding', 'sorted by start time');
    const pastList = await (await get('/events?scope=past')).json();
    assert.deepEqual(pastList.map((e) => e.id), [past.id]);
    assert.equal(pastList[0].weather, null);
    assert.equal((await get('/events?scope=everything')).status, 400);

    // ---- ownership ----
    assert.deepEqual(await (await get('/events', b)).json(), []);
    assert.equal((await get('/events/' + meeting.id, b)).status, 404);
    assert.equal((await send('PATCH', '/events/' + meeting.id, { title: 'Hijacked' }, b)).status, 404);
    assert.equal((await fetch(base + '/events/' + meeting.id, { method: 'DELETE', headers: json(b) })).status, 404);
    assert.equal((await get('/events/not-a-uuid')).status, 400);

    // ---- update ----
    assert.equal((await send('PATCH', '/events/' + meeting.id, { title: '  ' })).status, 400);
    const moved = await send('PATCH', '/events/' + lost.id, { city: '', eventType: 'CASUAL' });
    assert.equal(moved.status, 200);
    const movedBody = await moved.json();
    assert.equal(movedBody.city, null, 'an empty city falls back to the profile city');
    assert.equal(movedBody.weather.status, 'FORECAST');
    assert.equal(movedBody.weather.recommendationInput.eventType, 'CASUAL');
    assert.equal(movedBody.title, 'Trip');

    // ---- delete ----
    assert.equal((await fetch(base + '/events/' + meeting.id, { method: 'DELETE', headers: json(a) })).status, 200);
    assert.equal((await get('/events/' + meeting.id)).status, 404);
    // the forecast was fetched once for Testville and then served from the cache
    assert.equal(mock.requests.filter((r) => r.startsWith('/forecast') && r.includes('latitude=10')).length, 1);
  } finally {
    server.kill();
    mock.server.close();
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  }
});
