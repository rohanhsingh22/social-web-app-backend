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

  // Character system launch catalog (spec §5-7): exactly two free
  // characters + base items. Idempotent — safe to re-run.
  const characters = [
    {
      id: 'character-01',
      name: 'Aria',
      assetId: '/character-scene/female.glb',
      rigId: 'humanoid-v1',
      defaultLoadoutId: 'loadout-character-01-base',
      unlockType: 'free',
      unlockAmount: null as number | null,
    },
    {
      id: 'character-02',
      name: 'Kai',
      assetId: '/character-scene/male.glb',
      rigId: 'humanoid-v1',
      defaultLoadoutId: 'loadout-character-02-base',
      unlockType: 'free',
      unlockAmount: null as number | null,
    },
  ];
  for (const c of characters) {
    await prisma.character.upsert({
      where: { id: c.id },
      update: {
        name: c.name,
        assetId: c.assetId,
        rigId: c.rigId,
        defaultLoadoutId: c.defaultLoadoutId,
        unlockType: c.unlockType,
        unlockAmount: c.unlockAmount,
      },
      create: c,
    });
  }

  const items = [
    {
      id: 'skin-base-01',
      category: 'hair',
      assetId: 'color-skin-base',
      rigId: 'humanoid-v1',
      attachment: { type: 'skinned' },
      compatibleCharacterIds: ['character-01', 'character-02'],
      sourceType: 'base',
      eventId: null as string | null,
    },
    {
      id: 'hair-base-01',
      category: 'hair',
      assetId: 'color-hair-base',
      rigId: 'humanoid-v1',
      attachment: { type: 'skinned' },
      compatibleCharacterIds: ['character-01', 'character-02'],
      sourceType: 'base',
      eventId: null as string | null,
    },
    {
      id: 'outfit-top-base-01',
      category: 'outfit_top',
      assetId: 'color-outfit-top-base',
      rigId: 'humanoid-v1',
      attachment: { type: 'skinned' },
      compatibleCharacterIds: ['character-01', 'character-02'],
      sourceType: 'base',
      eventId: null as string | null,
    },
    {
      id: 'outfit-bottom-base-01',
      category: 'outfit_bottom',
      assetId: 'color-outfit-bottom-base',
      rigId: 'humanoid-v1',
      attachment: { type: 'skinned' },
      compatibleCharacterIds: ['character-01', 'character-02'],
      sourceType: 'base',
      eventId: null as string | null,
    },
    {
      id: 'headwear-base-cap-01',
      category: 'headwear',
      assetId: 'procedural-cap-01',
      rigId: 'humanoid-v1',
      attachment: { type: 'socket', socketName: 'headTop' },
      compatibleCharacterIds: ['character-01', 'character-02'],
      sourceType: 'base',
      eventId: null as string | null,
    },
    {
      id: 'eyewear-base-glasses-01',
      category: 'eyewear',
      assetId: 'procedural-glasses-01',
      rigId: 'humanoid-v1',
      attachment: { type: 'socket', socketName: 'faceFront' },
      compatibleCharacterIds: ['character-01', 'character-02'],
      sourceType: 'base',
      eventId: null as string | null,
    },
    {
      id: 'full-outfit-base-01',
      category: 'full_outfit',
      assetId: 'color-full-outfit-base',
      rigId: 'humanoid-v1',
      attachment: { type: 'skinned' },
      compatibleCharacterIds: ['character-01', 'character-02'],
      sourceType: 'base',
      eventId: null as string | null,
    },
  ];
  for (const item of items) {
    await prisma.characterItem.upsert({
      where: { id: item.id },
      update: {
        category: item.category,
        assetId: item.assetId,
        rigId: item.rigId,
        attachment: item.attachment,
        compatibleCharacterIds: item.compatibleCharacterIds,
        sourceType: item.sourceType,
        eventId: item.eventId,
      },
      create: item,
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
