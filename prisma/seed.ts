import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const channels = [
    { name: 'General', slug: 'general', type: 'general', isDefault: true, sortOrder: 0 },
    { name: 'English', slug: 'english', type: 'language', isDefault: false, sortOrder: 10 },
    { name: 'Hindi', slug: 'hindi', type: 'language', isDefault: false, sortOrder: 20 },
    { name: 'Gaming', slug: 'gaming', type: 'general', isDefault: false, sortOrder: 30 },
    { name: 'Study', slug: 'study', type: 'general', isDefault: false, sortOrder: 40 },
    { name: 'Music', slug: 'music', type: 'general', isDefault: false, sortOrder: 50 },
  ] as const;

  for (const channel of channels) {
    await prisma.channel.upsert({
      where: { slug: channel.slug },
      update: {
        name: channel.name,
        type: channel.type,
        isDefault: channel.isDefault,
        isActive: true,
        sortOrder: channel.sortOrder,
      },
      create: {
        ...channel,
        isActive: true,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
