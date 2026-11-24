// Demo data for local testing: one regular user with a small wardrobe and one admin.
// Photos: the CC0 clothing-dataset fixtures copied to scripts/demo-photos (originals in ../fixtures/photos); the outer
// layers (blazer, cardigan, jacket, coat, zip hoodie) use the 3D catalogue pictures, copied to demo-photos/catalog
// so the seed also works inside the API container (which has no frontend/).
// Re-running is safe: an item is added only when the user has none of that type and colour, events only when none.
// Credentials are written to .demo-accounts.local.json (git-ignored), never printed or committed.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { randomBytes, randomUUID } = require('node:crypto');
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { extname, join, resolve } = require('node:path');

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
  ['catalog:m-blazer.webp', 'BLAZER', 'gray', 'GOOD'],
  ['catalog:m-cardigan.webp', 'CARDIGAN', 'gray', 'GOOD'],
  ['catalog:m-jacket.webp', 'JACKET', 'gray', 'GOOD'],
  ['catalog:m-coat.webp', 'COAT', 'gray', 'LOOSE'],
  ['catalog:m-zip-hoodie.webp', 'HOODIE', 'gray', 'GOOD'],
];
/** [title, type, days from today, hour] — upcoming occasions for the recommendations */
const EVENTS = [
  ['Job interview', 'INTERVIEW', 1, 10],
  ['Gym', 'GYM', 1, 19],
  ['Dinner with friends', 'DATE', 2, 20],
  ['Walk in the park', 'FAMILY_WALK', 3, 12],
  ['Theater', 'THEATER', 5, 19],
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
        create: { email, passwordHash, isAdmin, name: role === 'admin' ? 'FitCast Admin' : 'Demo', city: 'London' },
      });
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { email: creds.user.email } });
    mkdirSync('uploads/wardrobe', { recursive: true });
    for (const [file, type, dominantColor, fitTag] of ITEMS) {
      if (await prisma.wardrobeItem.count({ where: { userId: user.id, type, dominantColor } })) continue;
      const src = join(FIXTURES, file.replace(/^catalog:/, 'catalog/'));
      if (!existsSync(src)) { console.warn('skip, no picture:', file); continue; }
      const name = randomUUID() + extname(src);
      copyFileSync(src, join('uploads/wardrobe', name));
      await prisma.wardrobeItem.create({ data: { userId: user.id, type, dominantColor, fitTag, imageUrl: '/uploads/wardrobe/' + name } });
    }
    if (!(await prisma.userEvent.count({ where: { userId: user.id } }))) {
      for (const [title, eventType, days, hour] of EVENTS) {
        const startsAt = new Date(); startsAt.setDate(startsAt.getDate() + days); startsAt.setHours(hour, 0, 0, 0);
        await prisma.userEvent.create({ data: { userId: user.id, title, eventType, startsAt } });
      }
    }
    writeFileSync(CREDS, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
    console.log(`Demo accounts ready (${creds.user.email}, ${creds.admin.email}); passwords in ${CREDS}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
