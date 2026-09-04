import Link from 'next/link';
import { ChevronRightIcon, ClockIcon, ImageOffIcon } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { formatCurrencyBRL } from '@/lib/format';
import type { CourtPublic } from '@/lib/types';

const SPORT_LABEL: Record<string, string> = {
  BEACH_VOLLEYBALL: 'Vôlei de praia',
};

// Fase "melhorias no fluxo de reserva" — `imageUrl` é uma URL externa colada
// pelo OWNER/ADMIN (nunca um upload, ver Court.imageUrl em schema.prisma),
// então pode apontar pra um host fora do controle do projeto. Um
// placeholder neutro cobre tanto "sem foto" (`imageUrl` nulo) quanto "a URL
// quebrou depois de cadastrada" (`onError`) — nunca um ícone de imagem
// quebrada do navegador, nem o card fica sem altura/proporção.
function CourtImage({ imageUrl, alt }: { imageUrl: string | null; alt: string }) {
  if (!imageUrl) {
    return (
      <div className="flex aspect-[16/9] w-full items-center justify-center rounded-t-xl bg-muted text-muted-foreground/50">
        <ImageOffIcon className="size-8" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-t-xl bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL externa
          arbitrária colada pelo OWNER (nunca um asset do próprio projeto);
          next/image exigiria configurar domínios remotos sem limite prático
          conhecido de antemão, contrariando a decisão desta fase de não
          criar infraestrutura nova para isso. */}
      <img
        src={imageUrl}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    </div>
  );
}

export function CourtCard({ arenaSlug, court }: { arenaSlug: string; court: CourtPublic }) {
  return (
    <Link href={`/arenas/${arenaSlug}/courts/${court.id}`} className="group block">
      {/* `pt-0` explícito: o card sempre começa com a foto/placeholder (nunca
          o header), então o espaçamento superior padrão do Card (Design
          System) precisa ser zerado aqui — mesma ideia do `has-[>img:first-child]:pt-0`
          já embutido no Card, só que também cobrindo o caso "sem foto"
          (placeholder é uma div, não um img). */}
      <Card className="h-full overflow-hidden pt-0 transition-all group-hover:-translate-y-0.5 group-hover:shadow-[0_4px_20px_-6px_oklch(0.19_0.014_265_/_14%)]">
        <CourtImage imageUrl={court.imageUrl} alt={court.name} />
        <CardHeader>
          <CardTitle>{court.name}</CardTitle>
          <CardDescription>{SPORT_LABEL[court.sport] ?? court.sport}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <span className="tabular text-base font-bold text-foreground">
            {formatCurrencyBRL(court.pricePerSlot)}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ClockIcon className="size-3.5" />
            {court.slotDurationMinutes} min
          </span>
        </CardContent>
        {/* Fase 33, item 4/5 — mesma pista de clicabilidade de ArenaCard/
            BookingCard, com o próximo passo real da jornada como texto
            (item 5 da fase cita "Escolher horário" como exemplo de CTA
            claro), não um "Ver mais" genérico. */}
        <CardFooter className="justify-end gap-0.5 text-xs font-medium text-muted-foreground">
          Escolher horário
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </CardFooter>
      </Card>
    </Link>
  );
}
