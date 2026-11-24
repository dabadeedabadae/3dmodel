const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');

// Minimal valid images (content is sniffed by the server, not the claimed MIME type).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('wardrobe CRUD is per-owner, validates input, and the admin recommendation bench builds the contract', async () => {
  const prisma = new PrismaClient();
  const server = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: '3103', RECOMMENDATION_SERVICE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  server.stdout.on('data', (c) => { out += c; });
  server.stderr.on('data', (c) => { out += c; });
  const base = 'http://127.0.0.1:3103';
  const emails = [`wardrobe-a-${randomUUID()}@example.com`, `wardrobe-b-${randomUUID()}@example.com`];
  const password = randomUUID();
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const form = (fields, image = PNG, type = 'image/png') => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    if (image) f.append('image', new Blob([image], { type }), 'shirt.png');
    return f;
  };
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (server.exitCode !== null) throw new Error(out);
      try { ready = (await fetch(base + '/wardrobe')).status === 401; } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, out);
    const tokens = [];
    for (const email of emails) {
      const r = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      assert.equal(r.status, 201);
      tokens.push((await r.json()).accessToken);
    }
    const [a, b] = tokens;
    const post = (fd, t = a) => fetch(base + '/wardrobe', { method: 'POST', headers: auth(t), body: fd });

    // Validation: no image, fake image bytes, bad enum, bad colour.
    assert.equal((await post(form({ type: 'TSHIRT', dominantColor: 'red', fitTag: 'GOOD' }, null))).status, 400);
    assert.equal((await post(form({ type: 'TSHIRT', dominantColor: 'red', fitTag: 'GOOD' }, Buffer.from('<?php echo 1;'), 'image/png'))).status, 400);
    assert.equal((await post(form({ type: 'CAPE', dominantColor: 'red', fitTag: 'GOOD' }))).status, 400);
    assert.equal((await post(form({ type: 'TSHIRT', dominantColor: '#ff0000', fitTag: 'GOOD' }))).status, 400);
    assert.equal((await fetch(base + '/wardrobe', { method: 'POST', body: form({ type: 'TSHIRT', dominantColor: 'red', fitTag: 'GOOD' }) })).status, 401);

    const created = await post(form({ type: 'TSHIRT', dominantColor: ' Grey ', fitTag: 'GOOD' }));
    assert.equal(created.status, 201, await created.clone().text());
    const item = await created.json();
    assert.equal(item.dominantColor, 'gray');
    assert.match(item.imageUrl, /^\/uploads\/wardrobe\/[0-9a-f-]{36}\.png$/);
    assert.equal((await fetch(base + item.imageUrl)).status, 200);
    assert.ok(!('userId' in item));
    await post(form({ type: 'JEANS', dominantColor: 'navy', fitTag: 'LOOSE' }));

    const listA = await (await fetch(base + '/wardrobe', { headers: auth(a) })).json();
    assert.equal(listA.length, 2);
    assert.deepEqual(await (await fetch(base + '/wardrobe', { headers: auth(b) })).json(), []);

    // Another user can neither change nor delete the item.
    const patchAs = (t, body, id = item.id) => fetch(base + '/wardrobe/' + id, { method: 'PATCH', headers: { ...auth(t), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await patchAs(b, { fitTag: 'TIGHT' })).status, 404);
    assert.equal((await fetch(base + '/wardrobe/' + item.id, { method: 'DELETE', headers: auth(b) })).status, 404);
    assert.equal((await patchAs(a, { fitTag: 'TIGHT' }, 'not-a-uuid')).status, 400);
    const patched = await patchAs(a, { fitTag: 'TIGHT', userId: randomUUID() });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).fitTag, 'TIGHT');

    // Recommendation bench: admin only, contract-shaped payload, no service configured.
    const userA = await prisma.user.findUnique({ where: { email: emails[0] } });
    const bench = (t) => fetch(base + '/admin/recommendations/test', { method: 'POST', headers: { ...auth(t), 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: userA.id, temperatureC: 12, precipitation: 'RAIN', eventType: 'CASUAL', limit: 3 }) });
    assert.equal((await bench(b)).status, 403);
    await prisma.user.update({ where: { email: emails[1] }, data: { isAdmin: true } });
    const r = await bench(b);
    assert.equal(r.status, 200);
    const { payload, service } = await r.json();
    assert.equal(service, null);
    assert.deepEqual(Object.keys(payload).sort(), ['eventType', 'limit', 'wardrobe', 'weather']);
    assert.equal(payload.wardrobe.length, 2);
    for (const w of payload.wardrobe) assert.deepEqual(Object.keys(w).sort(), ['dominantColor', 'fitTag', 'id', 'type']);
    assert.deepEqual(payload.weather, { temperatureC: 12, precipitation: 'RAIN' });

    // Photo → 3D package: valid one stored with its texture; server forces review on bad statuses; malformed rejected.
    const P = (x, y) => ({ x, y });
    const names = ['neck_left', 'neck_right', 'neck_bottom', 'shoulder_left', 'shoulder_right', 'armpit_left', 'armpit_right', 'cuff_left_top', 'cuff_left_bottom', 'cuff_right_top', 'cuff_right_bottom', 'hem_left', 'hem_right'];
    const pkg = (over = {}) => ({
      version: 1, category: 'tshirt', baseColor: '#AA3344', maskQuality: 'ok', landmarkStatus: 'ok', anchorIssues: [], needsReview: false, provider: 'u2netp',
      anchors: { width: 400, height: 500, points: Object.fromEntries(names.map((n, i) => [n, P(100 + i * 10, 100 + i * 20)])), rows: [0, 1, 2, 3].map((i) => ({ left: P(100, 400 - i * 50), right: P(300, 400 - i * 50) })) },
      ...over,
    });
    const with3d = (p, type = 'TSHIRT', texture = PNG) => { const f = form({ type, dominantColor: 'red', fitTag: 'GOOD', garment3d: JSON.stringify(p) }); if (texture) f.append('texture', new Blob([texture], { type: 'image/png' }), 't.png'); return f; };
    const ok3d = await post(with3d(pkg()));
    assert.equal(ok3d.status, 201, await ok3d.clone().text());
    const item3d = await ok3d.json();
    assert.equal(item3d.garment3d.needsReview, false);
    assert.equal(item3d.garment3d.baseColor, '#aa3344');
    assert.match(item3d.textureUrl, /^\/uploads\/wardrobe\/[0-9a-f-]{36}\.png$/);
    const forced = await (await post(with3d(pkg({ landmarkStatus: 'uncertain', needsReview: false })))).json();
    assert.equal(forced.garment3d.needsReview, true, 'server must not trust needsReview=false with uncertain points');
    const bad = [
      pkg({ anchors: { ...pkg().anchors, points: { ...pkg().anchors.points, hem_left: P(99999, 1) } } }),
      pkg({ anchors: { ...pkg().anchors, points: { ...pkg().anchors.points, extra: P(1, 1) } } }),
      pkg({ baseColor: 'red' }),
      pkg({ version: 2 }),
    ];
    for (const b of bad) assert.equal((await post(with3d(b))).status, 400, JSON.stringify(b).slice(0, 80));
    assert.equal((await post(form({ type: 'TSHIRT', dominantColor: 'red', fitTag: 'GOOD', garment3d: '{not json' }))).status, 400);
    assert.equal((await post(with3d(pkg(), 'TSHIRT', null))).status, 400, 'package without texture');
    assert.equal((await post(with3d(pkg(), 'JEANS'))).status, 400, 'package only for t-shirts');
    assert.equal((await post(with3d(pkg(), 'TSHIRT', Buffer.from('nope')))).status, 400, 'texture bytes are checked');
    // long-sleeved top package (I-63): same points as the T-shirt, valid for shirts, hoodies and sweaters only
    const okTop = await post(with3d(pkg({ category: 'top' }), 'SHIRT'));
    assert.equal(okTop.status, 201, await okTop.clone().text());
    assert.equal((await okTop.json()).garment3d.category, 'top');
    for (const t of ['HOODIE', 'SWEATER', 'BLAZER', 'JACKET', 'COAT']) assert.equal((await post(with3d(pkg({ category: 'top' }), t))).status, 201, `top package for ${t}`);
    assert.equal((await post(with3d(pkg({ category: 'top' }), 'TSHIRT'))).status, 400, 'long-sleeve package not for a T-shirt');
    assert.equal((await post(with3d(pkg(), 'SHIRT'))).status, 400, 'T-shirt package not for a shirt');
    assert.equal((await post(with3d(pkg({ category: 'dress' }), 'SHIRT'))).status, 400, 'unknown category');
    const userPts = await (await post(with3d(pkg({ category: 'top', pointsSource: 'user' }), 'HOODIE'))).json();
    assert.equal(userPts.garment3d.pointsSource, 'user', 'points placed by the person are kept as such');
    assert.equal(item3d.garment3d.pointsSource, 'auto', 'older packages default to estimator points');
    assert.equal((await post(with3d(pkg({ category: 'top', pointsSource: 'robot' }), 'SHIRT'))).status, 400, 'unknown points source');
    const topRows = await (await fetch(base + '/wardrobe', { headers: auth(a) })).json();
    for (const r of topRows.filter((x) => x.garment3d?.category === 'top')) await fetch(base + '/wardrobe/' + r.id, { method: 'DELETE', headers: auth(a) });
    // trousers package (I-53): valid for PANTS and JEANS, rejected for a T-shirt and when malformed
    const pnames = ['waist_left', 'waist_right', 'crotch', 'hip_left', 'hip_right', 'hem_left_outer', 'hem_left_inner', 'hem_right_inner', 'hem_right_outer'];
    const ppkg = (over = {}, anchorsOver = {}) => ({
      version: 1, category: 'pants', baseColor: '#334455', maskQuality: 'ok', landmarkStatus: 'ok', anchorIssues: [], needsReview: false, provider: 'u2netp',
      anchors: { width: 400, height: 500, points: Object.fromEntries(pnames.map((n, i) => [n, P(100 + i * 20, 50 + i * 40)])),
        seat: [0, 1, 2, 3, 4].map((i) => ({ left: P(100, 200 - i * 30), right: P(300, 200 - i * 30) })),
        legLeft: [...Array(9).keys()].map((i) => ({ outer: P(100, 200 + i * 30), inner: P(190, 200 + i * 30) })),
        legRight: [...Array(9).keys()].map((i) => ({ inner: P(210, 200 + i * 30), outer: P(300, 200 + i * 30) })), ...anchorsOver },
      ...over,
    });
    const okPants = await post(with3d(ppkg(), 'PANTS'));
    assert.equal(okPants.status, 201, await okPants.clone().text());
    const pantsItem = await okPants.json();
    assert.equal(pantsItem.garment3d.category, 'pants');
    assert.equal((await post(with3d(ppkg(), 'JEANS'))).status, 201, 'trousers package is valid for jeans');
    assert.equal((await post(with3d(ppkg(), 'TSHIRT'))).status, 400, 'trousers package not for a T-shirt');
    assert.equal((await post(with3d(ppkg({}, { seat: [] }), 'PANTS'))).status, 400, 'wrong number of seat rows');
    assert.equal((await post(with3d(ppkg({}, { rows: [] }), 'PANTS'))).status, 400, 'extra anchor field');
    assert.equal((await post(with3d(ppkg({ pointsSource: 'user' }), 'PANTS'))).status, 400, 'no manual points for trousers yet');
    const pantsRows = await (await fetch(base + '/wardrobe', { headers: auth(a) })).json();
    for (const r of pantsRows.filter((x) => x.garment3d?.category === 'pants')) await fetch(base + '/wardrobe/' + r.id, { method: 'DELETE', headers: auth(a) });

    const texFile = join(process.cwd(), item3d.textureUrl);
    assert.ok(existsSync(texFile));
    assert.equal((await fetch(base + '/wardrobe/' + item3d.id, { method: 'DELETE', headers: auth(a) })).status, 200);
    assert.ok(!existsSync(texFile), 'texture removed with the item');
    await fetch(base + '/wardrobe/' + forced.id, { method: 'DELETE', headers: auth(a) });

    // Delete removes the record and the stored file.
    const file = join(process.cwd(), item.imageUrl);
    assert.ok(existsSync(file));
    assert.equal((await fetch(base + '/wardrobe/' + item.id, { method: 'DELETE', headers: auth(a) })).status, 200);
    assert.ok(!existsSync(file));
    assert.equal((await (await fetch(base + '/wardrobe', { headers: auth(a) })).json()).length, 1);
  } finally {
    const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const leftovers = await prisma.wardrobeItem.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { imageUrl: true, textureUrl: true } });
    for (const l of leftovers) for (const u of [l.imageUrl, l.textureUrl]) { if (!u) continue; try { require('node:fs').unlinkSync(join(process.cwd(), u)); } catch {} }
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
    server.kill();
  }
});
