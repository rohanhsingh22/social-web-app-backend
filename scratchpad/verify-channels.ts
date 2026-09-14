import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const channels = await prisma.channel.findMany({
    select: { name: true, slug: true, type: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
  console.log(JSON.stringify(channels, null, 2));
  const langCount = channels.filter(c => c.type === 'language').length;
  console.log(`Total channels: ${channels.length}, Language channels: ${langCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
