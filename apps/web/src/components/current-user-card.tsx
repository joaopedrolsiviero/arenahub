'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect, useState } from 'react';

interface ApiUser {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

type State =
  | { status: 'loading' }
  | { status: 'success'; user: ApiUser }
  | { status: 'error'; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';

// Prova, na prática, que o fluxo completo funciona: pega o token de sessão
// do Clerk no navegador, chama o backend NestJS com ele e mostra o que
// GET /v1/users/me devolveu (ou o erro, se ainda não sincronizado / se der
// errado) — sem mock nenhum nesse caminho.
export function CurrentUserCard() {
  const { getToken } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function fetchMe() {
      setState({ status: 'loading' });
      try {
        const token = await getToken();
        const response = await fetch(`${API_URL}/users/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? 'Conta ainda não sincronizada com o backend (aguarde o webhook do Clerk e recarregue).'
              : `API respondeu ${response.status}`,
          );
        }

        const user = (await response.json()) as ApiUser;
        if (!cancelled) {
          setState({ status: 'success', user });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Erro desconhecido',
          });
        }
      }
    }

    void fetchMe();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <div className="w-full max-w-md rounded-lg border p-4 text-left text-sm">
      <p className="mb-2 font-medium">GET /v1/users/me</p>
      {state.status === 'loading' && (
        <p className="text-muted-foreground">Carregando…</p>
      )}
      {state.status === 'error' && <p className="text-destructive">{state.message}</p>}
      {state.status === 'success' && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">email</dt>
          <dd>{state.user.email}</dd>
          <dt className="text-muted-foreground">nome</dt>
          <dd>{state.user.name ?? '—'}</dd>
          <dt className="text-muted-foreground">criado em</dt>
          <dd>{new Date(state.user.createdAt).toLocaleString('pt-BR')}</dd>
        </dl>
      )}
    </div>
  );
}
