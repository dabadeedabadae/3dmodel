const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

test('admin endpoints enforce authentication, current database role, and safe responses', async () => {
  const prisma = new PrismaClient();
  const server = spawn(process.execPath, ['dist/main.js'], {
    env: { ...process.env, PORT: '3102' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk; });
  server.stderr.on('data', (chunk) => { serverOutput += chunk; });
  const base = 'http://127.0.0.1:3102';
  const email = `admin-test-${randomUUID()}@example.com`;
  const password = randomUUID();
  const otherEmail = `profile-other-${randomUUID()}@example.com`;
  const get = (path, token) => fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(serverOutput);
      try { ready = (await get('/users/me')).status === 401; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, serverOutput);
    for (const path of ['/admin/overview', '/admin/users', '/admin/wardrobe', '/admin/outfits']) {
      assert.equal((await get(path)).status, 401);
      assert.equal((await get(path, 'invalid-token')).status, 401);
    }
    const registration = await fetch(base + '/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, isAdmin: true }),
    });
    assert.equal(registration.status, 201);
    const { accessToken } = await registration.json();
    assert.equal((await (await get('/users/me', accessToken)).json()).isAdmin, false);
    for (const path of ['/admin/overview', '/admin/users', '/admin/wardrobe', '/admin/outfits']) {
      assert.equal((await get(path, accessToken)).status, 403);
    }
    const patch = (body, token = accessToken) => fetch(base + '/users/me', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    assert.equal((await patch({ name: 'Guest' }, null)).status, 401);
    const otherRegistration = await fetch(base + '/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otherEmail, password }),
    });
    assert.equal(otherRegistration.status, 201);
    const other = await otherRegistration.json();
    const updatedResponse = await patch({ name: '  Тимур  ', city: '  Алматы ', bio: 'Люблю casual', isAdmin: true, id: other.user.id, email: otherEmail });
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.name, 'Тимур'); assert.equal(updated.city, 'Алматы');
    assert.equal(updated.email, email); assert.equal(updated.isAdmin, false);
    assert.ok(!('passwordHash' in updated));
    const reread = await (await get('/users/me', accessToken)).json();
    assert.equal(reread.bio, 'Люблю casual');
    const untouched = await (await get('/users/me', other.accessToken)).json();
    assert.equal(untouched.name, null);
    for (const body of [{ name: 'x'.repeat(81) }, { city: 'x'.repeat(101) }, { bio: 'x'.repeat(301) }, { name: 123 }, { city: {} }]) {
      assert.equal((await patch(body)).status, 400);
    }
    const cleared = await (await patch({ bio: '   ' })).json();
    assert.equal(cleared.bio, null); assert.equal(cleared.name, 'Тимур');
    await prisma.wardrobeItem.create({ data: { userId: updated.id, type: 'TSHIRT', dominantColor: 'blue', fitTag: 'GOOD', imageUrl: 'https://example.com/test.jpg' } });
    const counts = await (await get('/users/me', accessToken)).json();
    assert.equal(counts._count.wardrobeItems, 1);
    assert.equal((await (await get('/users/me', other.accessToken)).json())._count.wardrobeItems, 0);
    const passwordPatch = (body, token = other.accessToken) => fetch(base + '/users/me/password', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: JSON.stringify(body),
    });
    assert.equal((await passwordPatch({ currentPassword: password, newPassword: 'ReplacementPass123!' }, null)).status, 401);
    assert.equal((await passwordPatch({ currentPassword: 'wrong-password', newPassword: 'ReplacementPass123!' })).status, 400);
    assert.equal((await passwordPatch({ currentPassword: password, newPassword: 'short' })).status, 400);
    assert.equal((await passwordPatch({ currentPassword: password, newPassword: password })).status, 400);
    assert.equal((await passwordPatch({ currentPassword: password, newPassword: 'Ж'.repeat(40) })).status, 400);
    assert.equal((await get('/users/me', other.accessToken)).status, 200);
    const newPassword = randomUUID();
    const changed = await passwordPatch({ currentPassword: password, newPassword, id: updated.id, userId: updated.id });
    assert.equal(changed.status, 200);
    assert.equal((await get('/users/me', other.accessToken)).status, 401);
    assert.equal((await get('/users/me', accessToken)).status, 200);
    const signIn = (pass) => fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otherEmail, password: pass }) });
    assert.equal((await signIn(password)).status, 401);
    const newLogin = await signIn(newPassword);
    assert.equal(newLogin.status, 200);
    assert.equal((await get('/users/me', (await newLogin.json()).accessToken)).status, 200);
    execFileSync(process.execPath, ['--env-file=.env', 'scripts/set-admin.cjs', email], { stdio: 'pipe' });
    const overviewResponse = await get('/admin/overview', accessToken);
    assert.equal(overviewResponse.status, 200);
    const overview = await overviewResponse.json();
    assert.equal(overview.users, await prisma.user.count());
    assert.equal(overview.wardrobeItems, await prisma.wardrobeItem.count());
    assert.equal(overview.savedOutfits, await prisma.savedOutfit.count());
    const usersResponse = await get('/admin/users', accessToken);
    assert.equal(usersResponse.status, 200);
    const users = await usersResponse.json();
    assert.ok(users.some((user) => user.email === email && user.isAdmin));
    assert.ok(users.length <= 100);
    assert.ok(users.every((user) => !('passwordHash' in user) && !('password' in user)));
    for (const path of ['/admin/wardrobe', '/admin/outfits']) {
      const response = await get(path, accessToken);
      assert.equal(response.status, 200);
      const records = await response.json();
      assert.ok(Array.isArray(records) && records.length <= 100);
      assert.ok(records.every((record) => typeof record.user.email === 'string' && !('passwordHash' in record.user)));
    }
    execFileSync(process.execPath, ['--env-file=.env', 'scripts/set-admin.cjs', email, 'revoke'], { stdio: 'pipe' });
    for (const path of ['/admin/overview', '/admin/users', '/admin/wardrobe', '/admin/outfits']) {
      assert.equal((await get(path, accessToken)).status, 403);
    }
  } finally {
    server.kill();
    await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await prisma.$disconnect();
  }
});
