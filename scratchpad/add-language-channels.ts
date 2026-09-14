import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const channels = [
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

async function main() {
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
    console.log('Upserted:', channel.name);
  }
  console.log('Done! Added', channels.length, 'language channels');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
