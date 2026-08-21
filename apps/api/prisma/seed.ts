import { PrismaClient, Sport, Weekday, ArenaRole } from '@prisma/client';

// Script de desenvolvimento — cria uma arena de teste com quadra ativa e
// horário de funcionamento completo, só para dar algo navegável ao testar a
// experiência de cliente (Fase 6) manualmente. Nunca rodar contra produção.
// O "dono" da arena é um usuário fictício (clerkId falso) que nunca faz
// login de verdade — qualquer usuário Clerk real pode reservar como
// CUSTOMER, já que a criação de reserva não exige ArenaMember.

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.upsert({
    where: { clerkId: 'seed_owner_dev' },
    update: {},
    create: {
      clerkId: 'seed_owner_dev',
      email: 'seed-owner@example.test',
      name: 'Dono de Teste (seed)',
    },
  });

  const arena = await prisma.arena.upsert({
    where: { slug: 'arena-praia-central' },
    update: {},
    create: {
      name: 'Arena Praia Central',
      slug: 'arena-praia-central',
      description: 'Arena de teste gerada pelo script de seed.',
      timezone: 'America/Sao_Paulo',
    },
  });

  await prisma.arenaMember.upsert({
    where: { arenaId_userId: { arenaId: arena.id, userId: owner.id } },
    update: {},
    create: { arenaId: arena.id, userId: owner.id, role: ArenaRole.OWNER },
  });

  const court = await prisma.court.upsert({
    where: { arenaId_name: { arenaId: arena.id, name: 'Quadra 1' } },
    update: {},
    create: {
      arenaId: arena.id,
      name: 'Quadra 1',
      sport: Sport.BEACH_VOLLEYBALL,
      description: 'Quadra de areia, iluminada.',
      pricePerSlot: 80,
      slotDurationMinutes: 60,
      bufferMinutes: 15,
    },
  });

  await prisma.arenaOperatingHours.deleteMany({ where: { arenaId: arena.id } });
  const weekdays = Object.values(Weekday);
  await prisma.arenaOperatingHours.createMany({
    data: weekdays.map((dayOfWeek) => ({
      arenaId: arena.id,
      dayOfWeek,
      opensAt: 8 * 60, // 08:00
      closesAt: 22 * 60, // 22:00
    })),
  });

  console.log('Seed concluído:');
  console.log(`  Arena: ${arena.name} (${arena.id}), timezone ${arena.timezone}`);
  console.log(`  Quadra: ${court.name} (${court.id}), R$ ${court.pricePerSlot}/slot`);
  console.log('  Horário: todo dia 08:00–22:00');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
