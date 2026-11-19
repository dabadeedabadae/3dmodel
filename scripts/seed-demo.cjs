// Demo data for local testing: one regular user with a small wardrobe and one admin.
// Photos: the CC0 clothing-dataset fixtures copied to scripts/demo-photos (originals in 3dmodel/fixtures/photos).
// Credentials are written to .demo-accounts.local.json (git-ignored), never printed or committed.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { randomBytes, randomUUID } = require('node:crypto');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const FIXTURES = resolve(process.env.FIXTURES_DIR ?? join(__dirname, 'demo-photos'));
const CREDS = process.env.DEMO_CREDS_FILE ?? '.demo-accounts.local.json';
const ITEMS = [
  ['tshirt_8f0cd82c.jpg', 'TSHIRT', 'gray', 'GOOD'],
  ['tshirt_0fc3fbae.jpg', 'TSHIRT', 'white', 'LOOSE'],
  ['longsleeve_107dd572.jpg', 'SWEATER', 'navy', 'GOOD'],
  ['pants_4cc4e673.jpg', 'JEANS', 'blue', 'GOOD'],
  ['pants_9cb9ae19.jpg', 'PANTS', 'black', 'TIGHT'],
  ['skirt_26921ddb.jpg', 'SKIRT', 'beige', 'GOOD'],
  ['shoes_bf583ce5.jpg', 'SHOES', 'black', 'GOOD'],
];

async function main() {
  const prisma = new PrismaClient();
  const creds = existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, 'utf8')) : {
    user: { email: 'demo@fitcast.test', password: randomBytes(9).toString('base64url') },
    admin: { email: 'admin@fitcast.test', password: randomBytes(9).toString('base64url') },
  };
  try {
    for (const [role, isAdmin] of [['user', false], ['admin', true]]) {
      const { email, password } = creds[role];
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.upsert({
        where: { email },
        update: { passwordHash, isAdmin, sessionVersion: { increment: 1 } },
        create: { email, passwordHash, isAdmin, name: role === 'admin' ? 'Админ FitCast' : 'Демо', city: 'Алматы' },
      });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { email: creds.user.email } });
    if (!(await prisma.wardrobeItem.count({ where: { userId: user.id } }))) {
      mkdirSync('uploads/wardrobe', { recursive: true });
      for (const [file, type, dominantColor, fitTag] of ITEMS) {
        const src = join(FIXTURES, file);
        if (!existsSync(src)) { console.warn('skip, no fixture:', file); continue; }
        const name = randomUUID() + '.jpg';
        copyFileSync(src, join('uploads/wardrobe', name));
        await prisma.wardrobeItem.create({ data: { userId: user.id, type, dominantColor, fitTag, imageUrl: '/uploads/wardrobe/' + name } });
      }
    }
    writeFileSync(CREDS, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
    console.log(`Demo accounts ready (${creds.user.email}, ${creds.admin.email}); passwords in ${CREDS}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
