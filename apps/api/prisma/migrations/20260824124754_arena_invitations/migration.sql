-- CreateTable
CREATE TABLE "ArenaInvitation" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ArenaRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "invitedByUserId" TEXT,
    "acceptedByUserId" TEXT,

    CONSTRAINT "ArenaInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArenaInvitation_tokenHash_key" ON "ArenaInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "ArenaInvitation_arenaId_idx" ON "ArenaInvitation"("arenaId");

-- CreateIndex
CREATE INDEX "ArenaInvitation_email_idx" ON "ArenaInvitation"("email");

-- AddForeignKey
ALTER TABLE "ArenaInvitation" ADD CONSTRAINT "ArenaInvitation_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaInvitation" ADD CONSTRAINT "ArenaInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaInvitation" ADD CONSTRAINT "ArenaInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Editado manualmente (Prisma não tem sintaxe para índice único parcial —
-- mesma técnica já usada em `arena_member_single_owner`, Fase 10).
--
-- Fase 11, item 14: "não permitir vários convites pendentes equivalentes
-- para mesma arena+email+role ao mesmo tempo". Um convite "ainda aberto"
-- (nem aceito, nem revogado) é o predicado da constraint — não inclui
-- `expiresAt`, porque comparar com `now()` num predicado de índice não é
-- permitido (precisa ser IMMUTABLE), e um convite tecnicamente expirado
-- mas "aberto" continua bloqueando um POST duplicado por design: o dono
-- deve reenviar (regenera o token no mesmo registro) em vez de criar um
-- segundo convite para o mesmo e-mail.
CREATE UNIQUE INDEX "ArenaInvitation_open_invite_key"
ON "ArenaInvitation" ("arenaId", "email", "role")
WHERE ("acceptedAt" IS NULL AND "revokedAt" IS NULL);
