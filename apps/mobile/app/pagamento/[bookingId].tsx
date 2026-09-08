import { useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { usePayment, useCreatePayment } from '@/hooks/usePayment';
import { formatCurrencyBRL, formatDateInZone, formatDateTimeInZone, formatTimeInZone } from '@/lib/format';
import { ApiError, ApiNetworkError } from '@/api/client';
import { colors, radius, spacing, typography } from '@/constants/theme';

/**
 * Pagamento PIX (M4) — só alcançada quando `arena.paymentMode === 'ONLINE'`
 * (ver handleConfirm em arena/[slug]/[courtId].tsx). Reutiliza EXATAMENTE
 * o contrato já validado em produção (Mercado Pago Payments API, PIX) —
 * confirmado lendo payments.controller.ts/payments.service.ts antes de
 * escrever este arquivo:
 *
 * - POST .../payments: sem corpo, exige Idempotency-Key; pode devolver 201
 *   com `status: FAILED` (falha do provider tratada como sucesso HTTP —
 *   nunca joga um erro nesse caso, ver PaymentsService.createPayment) — o
 *   `catch` abaixo trata só falhas de INFRAESTRUTURA (401/403/404/409/429/
 *   5xx/rede), nunca o desfecho de negócio "pagamento recusado".
 * - GET .../payment: `null` quando nunca houve tentativa — nunca 404 nesse caso.
 *
 * PIX nativo (QR base64 + copia-e-cola) — nunca checkoutUrl, nunca WebView,
 * nunca SDK do Mercado Pago (item 12/13 do prompt): os dois campos já vêm
 * prontos do backend, só precisam ser exibidos.
 */
export default function PagamentoScreen() {
  const { bookingId, startsAt, endsAt, total, arenaName, courtName, timezone } = useLocalSearchParams<{
    bookingId: string;
    startsAt: string;
    endsAt: string;
    total: string;
    arenaName: string;
    courtName: string;
    timezone: string;
  }>();

  const { data: payment, isPending, isError, refetch } = usePayment(bookingId);
  const createPayment = useCreatePayment(bookingId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Idempotency-Key da tentativa lógica ATUAL (M4, item 10/17) — um `ref`,
  // não estado: nunca precisa disparar re-render, só precisa sobreviver a
  // re-renders/polling/remount da MESMA tentativa. Só é zerada
  // explicitamente quando o usuário reinicia uma tentativa genuinamente
  // NOVA depois de um estado terminal de falha (ver handleCreatePayment).
  const attemptKeyRef = useRef<string | null>(null);

  function signInUrl(): string {
    return `/(auth)/sign-in?redirect=${encodeURIComponent(`/pagamento/${bookingId}`)}`;
  }

  async function handleCreatePayment() {
    setErrorMessage(null);
    const isFreshAttempt = payment?.status === 'FAILED' || payment?.status === 'EXPIRED';
    if (isFreshAttempt || !attemptKeyRef.current) {
      attemptKeyRef.current = Crypto.randomUUID();
    }
    try {
      await createPayment.mutateAsync({ idempotencyKey: attemptKeyRef.current });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Sessão expirou — preserva o contexto (a própria Booking já criada,
        // identificada só por bookingId) e volta pra cá depois do login,
        // nunca cria uma segunda reserva (M4, item 18/22).
        router.push(signInUrl());
      } else if (error instanceof ApiError && error.status === 409) {
        // Conflito (reserva cancelada / já paga / etc.) — o recurso real já
        // existe, nunca cria outro; só relê o estado real (M4, item 11/22).
        await refetch();
      } else if (error instanceof ApiError && error.status === 403) {
        setErrorMessage('Você não tem permissão para realizar esta ação.');
      } else if (error instanceof ApiError && error.status === 404) {
        setErrorMessage('Reserva não encontrada.');
      } else if (error instanceof ApiError && error.status === 429) {
        setErrorMessage('Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.');
      } else if (error instanceof ApiNetworkError) {
        // M4, item 22 — nunca assume que o timeout significa "não foi
        // criado": relê o estado real antes de deixar o usuário tentar nova
        // criação. A MESMA chave continua guardada pra um retry seguro.
        await refetch();
        setErrorMessage(
          'Não foi possível confirmar sua conexão. Verifique se o PIX apareceu abaixo antes de tentar de novo.',
        );
      } else {
        setErrorMessage('Não foi possível iniciar o pagamento agora. Tente novamente.');
      }
    }
  }

  async function handleCopyPix(code: string) {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem feedback de erro — o campo com o código continua visível e
      // selecionável manualmente como alternativa.
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Pagamento' }} />
      <View style={styles.content}>
        <Card style={styles.summaryCard}>
          <Text style={styles.arenaName}>{arenaName}</Text>
          <Text style={styles.courtName}>{courtName}</Text>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Data</Text>
            <Text style={styles.rowValue}>{formatDateInZone(startsAt, timezone)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Horário</Text>
            <Text style={styles.rowValue}>
              {formatTimeInZone(startsAt, timezone)}–{formatTimeInZone(endsAt, timezone)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Total</Text>
            {/* Enquanto não existe Payment, o total da própria Booking (M3)
                é a melhor estimativa disponível; assim que existir um
                Payment real, `payment.amount` (autoridade do backend)
                substitui — nunca um cálculo local (M4, item 8/17). */}
            <Text style={[styles.rowValue, styles.totalValue]}>
              {formatCurrencyBRL(payment?.amount ?? total)}
            </Text>
          </View>
        </Card>

        {isPending ? <LoadingState label="Carregando pagamento…" /> : null}
        {isError ? (
          <ErrorState message="Não foi possível carregar o pagamento." onRetry={() => refetch()} />
        ) : null}

        {errorMessage ? (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {!isPending && !isError && !payment ? (
          <Card style={styles.payCard}>
            <Text style={styles.payHint}>Pague com PIX para confirmar sua reserva.</Text>
            <Button onPress={handleCreatePayment} disabled={createPayment.isPending} testID="generate-pix">
              {createPayment.isPending ? 'Gerando PIX…' : 'Gerar PIX'}
            </Button>
          </Card>
        ) : null}

        {payment?.status === 'PENDING' ? (
          <Card style={styles.payCard}>
            <View style={styles.statusRow}>
              <Ionicons name="time-outline" size={18} color={colors.mutedForeground} />
              <Text style={styles.statusText}>Aguardando confirmação do pagamento…</Text>
            </View>
            {payment.qrCodeBase64 ? (
              <Image
                source={{ uri: `data:image/png;base64,${payment.qrCodeBase64}` }}
                accessibilityLabel="QR Code do PIX"
                style={styles.qrCode}
                resizeMode="contain"
              />
            ) : null}
            {payment.pixCopyPaste ? (
              <View style={styles.pixCopyWrap}>
                <Text style={styles.pixCopyLabel}>Código PIX copia e cola</Text>
                <View style={styles.pixCopyRow}>
                  <Text style={styles.pixCopyText} numberOfLines={1} testID="pix-copy-paste">
                    {payment.pixCopyPaste}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copied ? 'Código copiado' : 'Copiar código PIX'}
                    onPress={() => handleCopyPix(payment.pixCopyPaste!)}
                    style={styles.copyButton}
                    testID="copy-pix"
                  >
                    <Ionicons
                      name={copied ? 'checkmark' : 'copy-outline'}
                      size={18}
                      color={colors.foreground}
                    />
                  </Pressable>
                </View>
              </View>
            ) : null}
            {payment.expiresAt ? (
              <Text style={styles.expiresHint}>
                Expira em {formatDateTimeInZone(payment.expiresAt, timezone)}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {payment?.status === 'PAID' ? (
          <Card style={styles.payCard}>
            <View style={styles.iconWrap}>
              <Ionicons name="checkmark-circle" size={48} color={colors.brand} />
            </View>
            <Text style={styles.successTitle}>Pagamento confirmado!</Text>
            {payment.paidAt ? (
              <Text style={styles.statusText}>Pago em {formatDateTimeInZone(payment.paidAt, timezone)}.</Text>
            ) : null}
          </Card>
        ) : null}

        {payment?.status === 'FAILED' ? (
          <Card style={styles.payCard}>
            <Text style={styles.statusText}>Pagamento não aprovado.</Text>
            <Button onPress={handleCreatePayment} disabled={createPayment.isPending} testID="retry-payment">
              {createPayment.isPending ? 'Gerando novo PIX…' : 'Tentar novamente'}
            </Button>
          </Card>
        ) : null}

        {payment?.status === 'EXPIRED' ? (
          <Card style={styles.payCard}>
            <Text style={styles.statusText}>O prazo para pagar esse PIX expirou.</Text>
            <Button onPress={handleCreatePayment} disabled={createPayment.isPending} testID="retry-payment">
              {createPayment.isPending ? 'Gerando novo PIX…' : 'Tentar novamente'}
            </Button>
          </Card>
        ) : null}

        {payment?.status === 'CANCELLED' ? (
          <Card style={styles.payCard}>
            <Text style={styles.statusText}>
              Esta tentativa de pagamento foi cancelada porque a reserva foi cancelada.
            </Text>
          </Card>
        ) : null}

        {payment?.status === 'REFUNDING' ? (
          <Card style={styles.payCard}>
            <Text style={styles.statusText}>
              Reembolso solicitado — aguardando confirmação do Mercado Pago.
            </Text>
          </Card>
        ) : null}

        {payment?.status === 'REFUNDED' ? (
          <Card style={styles.payCard}>
            <Text style={styles.statusText}>Reembolsado integralmente.</Text>
          </Card>
        ) : null}

        <Button variant="ghost" onPress={() => router.replace('/(tabs)/reservas')} testID="see-my-bookings">
          Ver minhas reservas
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  summaryCard: { gap: spacing.xs },
  arenaName: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  courtName: { fontSize: typography.title.fontSize, fontWeight: typography.title.fontWeight, color: colors.foreground },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowLabel: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  rowValue: { fontSize: typography.body.fontSize, fontWeight: '600', color: colors.foreground },
  totalValue: { fontSize: typography.title.fontSize, fontWeight: '700' },
  errorBanner: { backgroundColor: colors.destructive, borderRadius: radius.lg, padding: spacing.md },
  errorText: { color: colors.destructiveForeground, fontSize: typography.body.fontSize },
  payCard: { gap: spacing.sm, alignItems: 'stretch' },
  payHint: { fontSize: typography.body.fontSize, color: colors.mutedForeground, textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center' },
  statusText: { fontSize: typography.body.fontSize, color: colors.mutedForeground, textAlign: 'center' },
  qrCode: { width: 220, height: 220, alignSelf: 'center' },
  pixCopyWrap: { gap: spacing.xs },
  pixCopyLabel: { fontSize: typography.label.fontSize, fontWeight: '600', color: colors.foreground },
  pixCopyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    height: 44,
  },
  pixCopyText: { flex: 1, fontSize: typography.caption.fontSize, color: colors.foreground },
  copyButton: { padding: spacing.xs },
  expiresHint: { fontSize: typography.caption.fontSize, color: colors.mutedForeground, textAlign: 'center' },
  iconWrap: { alignItems: 'center' },
  successTitle: {
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
    color: colors.foreground,
    textAlign: 'center',
  },
});
