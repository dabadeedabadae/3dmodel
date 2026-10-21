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
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  }
});
