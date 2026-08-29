'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateArena } from '@/hooks/use-api';
import { useTimezoneOptions, detectBrowserTimezone } from '@/hooks/use-timezone-options';
import { RequireAuth } from '@/components/require-auth';
import { SiteHeader } from '@/components/site-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError } from '@/lib/api';

// Sem utilitário de slug compartilhado com o backend (mesma observação já
// registrada em CreateArenaDto) — regra local só precisa bater com o
// SLUG_PATTERN do backend (minúsculas, dígitos, hífen simples entre
// palavras); o backend continua validando de verdade, isto é só conveniência
// de UI pra não obrigar o OWNER a digitar o slug à mão.
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function CreateArenaForm() {
  const router = useRouter();
  const createArena = useCreateArena();
  const timezones = useTimezoneOptions();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Só true até o OWNER editar o slug manualmente — depois disso o campo
  // vira independente do nome (evita sobrescrever uma edição intencional).
  const [slugTouched, setSlugTouched] = useState(false);
  const [timezone, setTimezone] = useState(() => detectBrowserTimezone());
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(slugify(value));
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const arena = await createArena.mutateAsync({
        name,
        slug,
        timezone,
        description: description.trim().length > 0 ? description : undefined,
      });
      // Próximo passo natural da jornada (item 18): direto pra criação da
      // primeira quadra, nunca deixando o OWNER descobrir sozinho onde fica
      // no dashboard.
      router.push(`/dashboard/${arena.id}/quadras`);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : 'Não foi possível criar a arena. Tente novamente.',
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Dados básicos</CardTitle>
          <CardDescription>Nome e endereço público da sua arena no ArenaHub.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arena-name">Nome</Label>
            <Input
              id="arena-name"
              value={name}
              onChange={(event) => handleNameChange(event.target.value)}
              required
              maxLength={120}
              placeholder="Ex: Arena Central"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arena-slug">Endereço (slug)</Label>
            <Input
              id="arena-slug"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              required
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="arena-central"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Só letras minúsculas, números e hífen. Gerado automaticamente a partir do nome — pode
              editar se quiser. Não pode ser alterado depois de criada a arena.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="arena-description">Descrição (opcional)</Label>
            <Input
              id="arena-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
          <CardDescription>
            Usado para calcular horário de funcionamento e disponibilidade — nunca alterado
            automaticamente depois.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <select
            id="arena-timezone"
            aria-label="Timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="h-8 w-fit rounded-lg border border-input bg-transparent px-2.5 text-sm"
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Detectamos <span className="font-mono">{detectBrowserTimezone()}</span> a partir do seu
            navegador — troque se sua arena fica em outro fuso.
          </p>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Erro</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={createArena.isPending}>
          {createArena.isPending ? 'Criando…' : 'Criar arena'}
        </Button>
      </div>
    </form>
  );
}

export default function NovaArenaPage() {
  return (
    <RequireAuth>
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8 sm:px-6">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Criar arena</h1>
          <p className="text-sm text-muted-foreground">
            Você vira proprietário (OWNER) desta arena automaticamente.
          </p>
        </div>
        <CreateArenaForm />
      </div>
    </RequireAuth>
  );
}
