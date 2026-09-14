import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const channels = [
    { name: 'General', slug: 'general', type: 'general', isDefault: true, sortOrder: 0 },
    { name: 'English', slug: 'english', type: 'language', isDefault: false, sortOrder: 10 },
    { name: 'Hindi', slug: 'hindi', type: 'language', isDefault: false, sortOrder: 20 },
    { name: 'Bengali', slug: 'bengali', type: 'language', isDefault: false, sortOrder: 30 },
    { name: 'Marathi', slug: 'marathi', type: 'language', isDefault: false, sortOrder: 40 },
    { name: 'Telugu', slug: 'telugu', type: 'language', isDefault: false, sortOrder: 50 },
    { name: 'Tamil', slug: 'tamil', type: 'language', isDefault: false, sortOrder: 60 },
    { name: 'Gujarati', slug: 'gujarati', type: 'language', isDefault: false, sortOrder: 70 },
    { name: 'Urdu', slug: 'urdu', type: 'language', isDefault: false, sortOrder: 80 },
    { name: 'Kannada', slug: 'kannada', type: 'language', isDefault: false, sortOrder: 90 },
    { name: 'Odia', slug: 'odia', type: 'language', isDefault: false, sortOrder: 100 },
    { name: 'Malayalam', slug: 'malayalam', type: 'language', isDefault: false, sortOrder: 110 },
    { name: 'Assamese', slug: 'assamese', type: 'language', isDefault: false, sortOrder: 120 },
    { name: 'Nepali', slug: 'nepali', type: 'language', isDefault: false, sortOrder: 130 },
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
