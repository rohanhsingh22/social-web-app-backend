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

  // Launch 1 Tolies: fixed reference data, never user-created.
  const tolis = [
    {
      name: 'Vector',
      description: 'For people who move with purpose and direction.',
      motto: 'Move with purpose.',
    },
    {
      name: 'Wave',
      description: 'For people who go with the flow and lift others up.',
      motto: 'Ride together.',
    },
    {
      name: 'Quantum',
      description: 'For curious minds who love big ideas and deep talks.',
      motto: 'Stay curious.',
    },
    {
      name: 'Orbit',
      description: 'For loyal souls who keep their circle close.',
      motto: 'Hold your circle.',
    },
    {
      name: 'Flux',
      description: 'For free spirits who embrace change and new energy.',
      motto: 'Embrace change.',
    },
  ];

  const toliIds = new Map<string, string>();

  for (const toli of tolis) {
    const record = await prisma.toli.upsert({
      where: { name: toli.name },
      update: {
        description: toli.description,
        motto: toli.motto,
      },
      create: toli,
    });
    toliIds.set(record.name, record.id);
  }

  // Toli rooms: private, one per Toli, membership-enforced. Never listed
  // publicly and never served through the public channel endpoints.
  let toliSortOrder = 140;
  for (const toli of tolis) {
    const toliId = toliIds.get(toli.name);

    if (!toliId) {
      throw new Error(`Missing Toli id for ${toli.name} during seed`);
    }

    const slug = `toli-${toli.name.toLowerCase()}`;
    await prisma.channel.upsert({
      where: { slug },
      update: {
        name: `${toli.name} Chat`,
        type: 'toli',
        visibility: 'private',
        isDefault: false,
        isActive: true,
        sortOrder: toliSortOrder,
        toliId,
      },
      create: {
        name: `${toli.name} Chat`,
        slug,
        type: 'toli',
        visibility: 'private',
        isDefault: false,
        isActive: true,
        sortOrder: toliSortOrder,
        toliId,
      },
    });
    toliSortOrder += 10;
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
