import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-expo';
import type { PublicUser } from '@/types/user';

interface UpdateMyProfileVariables {
  firstName: string;
  lastName: string;
}

/**
 * Edição de perfil (M6) — NUNCA chama `PATCH /v1/users/me`: a auditoria desta
 * fase confirmou que esse endpoint está documentado em docs/ARCHITECTURE.md
 * (Parte 9) mas nunca foi implementado (`users.controller.ts` só tem
 * `@Get('me')`; `UsersService` não tem nenhum método de update). O único
 * escritor real dos campos de domínio do usuário é o webhook do Clerk
 * (`UsersService.syncFromClerkEvent`, disparado em `user.created`/
 * `user.updated`) — ou seja, `name` é estruturalmente um campo do CLERK,
 * espelhado (nunca editado) pelo backend.
 *
 * Por isso a escrita real acontece via `user.update({firstName, lastName})`
 * do próprio Clerk (mesmo SDK já usado para sessão/token, nunca uma
 * autenticação/mecanismo novo) — o único campo com um caminho de escrita
 * simples e direto no Clerk sem fluxo de verificação (email/telefone exigem
 * `createEmailAddress`/`createPhoneNumber` + confirmação por código,
 * fora do escopo desta fase — permanecem somente leitura).
 *
 * Após o `update()` do Clerk confirmar sucesso (a autoridade real da
 * escrita), a cache de `['my-profile']` (o espelho do backend) é corrigida
 * localmente com a MESMA fórmula que `syncFromClerkEvent` usa
 * (`[firstName, lastName].filter(Boolean).join(' ').trim() || null`) — não é
 * uma atualização otimista "torcendo para dar certo": o Clerk já confirmou a
 * escrita, isto só evita mostrar o nome antigo por alguns instantes até o
 * webhook processar. Em seguida invalida a query pra reconciliar com o
 * espelho real do backend assim que ele chegar.
 */
export function useUpdateMyProfile() {
  const { user } = useUser();
  const queryClient = useQueryClient();

  return useMutation<void, unknown, UpdateMyProfileVariables>({
    mutationFn: async ({ firstName, lastName }) => {
      if (!user) {
        throw new Error('Sessão não carregada.');
      }
      await user.update({ firstName, lastName });
    },
    onSuccess: async (_result, variables) => {
      const name = [variables.firstName, variables.lastName].filter(Boolean).join(' ').trim() || null;
      queryClient.setQueryData<PublicUser>(['my-profile'], (old) => (old ? { ...old, name } : old));
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}
