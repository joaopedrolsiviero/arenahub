'use client';

import { Suspense, use } from 'react';
import { useRouter } from 'next/navigation';
import { useArenaCustomer, useArenaCustomerBookings, useDashboard, useMyAdminArenas } from '@/hooks/use-api';
import { DashboardHeader } from '@/components/dashboard-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/async-state';
import { RequireAuth } from '@/components/require-auth';
import { BookingStatusBadge } from '@/components/booking-status-badge';
import { PaymentStatusBadge } from '@/components/payment-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatCurrencyBRL, formatDateInZone, formatTimeInZone } from '@/lib/format';

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tabular text-lg font-bold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function CustomerDetail({ arenaId, userId }: { arenaId: string; userId: string }) {
  const router = useRouter();
  const { data: adminArenas } = useMyAdminArenas();
  const { data: dashboard } = useDashboard(arenaId, undefined);
  const timezone = dashboard?.arena.timezone ?? 'UTC';

  const { data: customer, isPending, isError } = useArenaCustomer(arenaId, userId);
  const { data: bookings, isPending: bookingsPending } = useArenaCustomerBookings(arenaId, userId);

  return (
    <>
      <DashboardHeader
        arenaId={arenaId}
        arenaName={dashboard?.arena.name ?? '…'}
        adminArenas={adminArenas ?? []}
      />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => router.push(`/dashboard/${arenaId}/clientes`)}
        >
          ← Voltar para clientes
        </Button>

        {isPending ? <LoadingState label="Carregando cliente…" /> : null}
        {isError ? <ErrorState message="Cliente não encontrado nesta arena." /> : null}

        {customer ? (
          <>
            <div>
              <h2 className="font-heading text-xl font-bold tracking-tight">
                {customer.name ?? customer.email}
              </h2>
              {customer.name ? (
                <p className="text-sm text-muted-foreground">{customer.email}</p>
              ) : null}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Resumo</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <SummaryStat label="reservas" value={String(customer.totalBookings)} />
                <SummaryStat label="confirmadas" value={String(customer.confirmedBookings)} />
                <SummaryStat label="canceladas" value={String(customer.cancelledBookings)} />
                <SummaryStat label="receita estimada" value={formatCurrencyBRL(customer.totalRevenue)} />
                <SummaryStat
                  label="primeira reserva"
                  value={formatDateInZone(customer.firstBookingAt, timezone)}
                />
                <SummaryStat
                  label="última reserva"
                  value={formatDateInZone(customer.lastBookingAt, timezone)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Histórico</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-0">
                {bookingsPending ? <LoadingState label="Carregando histórico…" /> : null}
                {bookings && bookings.length === 0 ? (
                  <EmptyState message="Nenhuma reserva encontrada." />
                ) : null}
                {bookings?.map((booking, index) => (
                  <div key={booking.id}>
                    {index > 0 ? <Separator /> : null}
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">
                          {formatDateInZone(booking.startsAt, timezone)} ·{' '}
                          {formatTimeInZone(booking.startsAt, timezone)}–
                          {formatTimeInZone(booking.endsAt, timezone)}
                        </span>
                        <span className="text-xs text-muted-foreground">{booking.court.name}</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2.5">
                        <span className="tabular text-sm font-semibold">
                          {formatCurrencyBRL(booking.total)}
                        </span>
                        <BookingStatusBadge status={booking.status} />
                        {booking.paymentStatus ? (
                          <PaymentStatusBadge status={booking.paymentStatus} />
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}

export default function ClienteDetailPage({
  params,
}: {
  params: Promise<{ arenaId: string; userId: string }>;
}) {
  const { arenaId, userId } = use(params);
  return (
    <RequireAuth>
      <Suspense fallback={<LoadingState label="Carregando…" />}>
        <CustomerDetail arenaId={arenaId} userId={userId} />
      </Suspense>
    </RequireAuth>
  );
}
