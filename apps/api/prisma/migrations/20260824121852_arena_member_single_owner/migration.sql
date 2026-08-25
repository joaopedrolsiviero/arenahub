-- Editado manualmente (Prisma não tem sintaxe para índice único parcial —
-- mesma situação já registrada para a EXCLUDE constraint de Booking, ver
-- migration `booking_availability`).
--
-- Fase 10, item 13/40: "cada arena deve possuir no máximo um OWNER" nunca
-- foi garantido pelo banco até agora — só pela ordem de chamadas da
-- aplicação (ArenasService.create cria o primeiro OWNER numa transação, mas
-- nada impedia um segundo INSERT com role=OWNER na mesma arena). Um índice
-- único parcial (só sobre as linhas WHERE role = 'OWNER') é a forma correta
-- de expressar "no máximo um OWNER por arenaId" sem impedir múltiplos ADMIN
-- na mesma arena — um UNIQUE(arenaId) comum bloquearia isso também.
--
-- Sem risco de dado existente violar a constraint: nenhuma arena até hoje
-- teve mais de um OWNER (garantido pelo próprio fluxo de criação de arena),
-- e não há endpoint que crie um segundo OWNER.
CREATE UNIQUE INDEX "ArenaMember_arenaId_single_owner"
ON "ArenaMember" ("arenaId")
WHERE ("role" = 'OWNER');
