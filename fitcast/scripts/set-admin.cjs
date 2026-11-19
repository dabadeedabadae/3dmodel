const { PrismaClient } = require('@prisma/client');

async function main() {
  const email = process.argv[2]?.trim();
  const mode = process.argv[3] ?? 'grant';
  if (!email || !['grant', 'revoke'].includes(mode)) {
    throw new Error('Usage: npm run admin:set -- user@example.com [grant|revoke]');
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error('User not found. Register this account first.');
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: mode === 'grant' } });
    console.log(`Administrator access ${mode === 'grant' ? 'granted to' : 'revoked from'} ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
