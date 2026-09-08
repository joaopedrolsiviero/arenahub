import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { Screen } from '@/components/Screen';
import { Header } from '@/components/Header';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { useMyProfile } from '@/hooks/useMyProfile';
import { useUpdateMyProfile } from '@/hooks/useUpdateMyProfile';
import {
  useExpoPushToken,
  usePushPermissionStatus,
  useRemovePushToken,
  useRequestPushPermission,
} from '@/hooks/usePushToken';
import { formatDate } from '@/lib/format';
import { ApiError } from '@/api/client';
import { colors, radius, spacing, typography } from '@/constants/theme';

/**
 * Perfil (M6) — GET /users/me (real, funcional) + edição de nome via Clerk.
 *
 * ACHADO DE AUDITORIA (ver relatório final, seção 3): `PATCH /v1/users/me`
 * está documentado em docs/ARCHITECTURE.md (Parte 9) mas NUNCA foi
 * implementado no backend (`users.controller.ts` só tem `@Get('me')`, sem
 * nenhum `@Patch`/DTO/método de update em `UsersService`). Os campos de
 * domínio do usuário (name/phone/avatarUrl/email) são escritos
 * exclusivamente pelo webhook do Clerk (`UsersService.syncFromClerkEvent`).
 *
 * Por isso: `name` (o único campo com escrita simples e direta no Clerk,
 * `user.update({firstName,lastName})`, sem fluxo de verificação) é editável
 * aqui via `useUpdateMyProfile` (Clerk, nunca um PATCH inexistente do
 * ArenaHub); `email`/`phone`/`avatarUrl` permanecem somente leitura nesta
 * fase — editá-los no Clerk exige `createEmailAddress`/`createPhoneNumber` +
 * verificação por código, um fluxo bem maior, fora do escopo pedido.
 */
export default function PerfilScreen() {
  const { isLoaded, isSignedIn, signOut, getToken } = useAuth();
  const { user } = useUser();
  const canQuery = isLoaded && isSignedIn === true;
  const profileQuery = useMyProfile(canQuery);
  const updateProfile = useUpdateMyProfile();

  // M7 — mesmo estado (query key) que app/_layout.tsx já usa pra registrar
  // o token automaticamente quando a permissão está concedida; aqui é só
  // lido, pra UI e pra saber qual token remover no logout.
  const permissionQuery = usePushPermissionStatus();
  const requestPermission = useRequestPushPermission();
  const canFetchPushToken = canQuery && permissionQuery.data?.status === 'granted';
  const expoPushTokenQuery = useExpoPushToken(canFetchPushToken);
  const removePushToken = useRemovePushToken();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const originalFirstName = (user?.firstName ?? '').trim();
  const originalLastName = (user?.lastName ?? '').trim();
  const trimmedFirstName = firstName.trim();
  const trimmedLastName = lastName.trim();
  const hasChanges = trimmedFirstName !== originalFirstName || trimmedLastName !== originalLastName;

  function startEditing() {
    setFirstName(user?.firstName ?? '');
    setLastName(user?.lastName ?? '');
    setFormError(null);
    setSuccessMessage(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setFormError(null);
  }

  async function handleSave() {
    setFormError(null);
    if (!trimmedFirstName) {
      setFormError('Informe seu nome.');
      return;
    }
    try {
      await updateProfile.mutateAsync({ firstName: trimmedFirstName, lastName: trimmedLastName });
      setEditing(false);
      setSuccessMessage('Perfil atualizado.');
    } catch {
      // Mensagem técnica do Clerk nunca é repassada direto ao usuário — só
      // uma mensagem compreensível; os dados digitados permanecem no
      // formulário (nunca perdidos num erro, M6 item 9).
      setFormError('Não foi possível salvar suas alterações. Tente novamente.');
    }
  }

  if (!isLoaded) {
    return (
      <Screen>
        <Header title="Meu perfil" />
        <LoadingState label="Carregando sessão…" />
      </Screen>
    );
  }

  if (!isSignedIn) {
    return (
      <Screen>
        <Header title="Meu perfil" />
        <Card style={styles.card}>
          <Text style={styles.hint}>Você não está conectado.</Text>
          <Button testID="profile-sign-in" onPress={() => router.push('/(auth)/sign-in')}>
            Entrar
          </Button>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Meu perfil" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {profileQuery.isPending ? <LoadingState label="Carregando perfil…" /> : null}

          {profileQuery.isError ? (
            <ErrorState
              message={
                profileQuery.error instanceof ApiError && profileQuery.error.status === 404
                  ? 'Sua conta está sendo sincronizada. Tente novamente em instantes.'
                  : 'Não foi possível carregar seu perfil.'
              }
              onRetry={() => profileQuery.refetch()}
            />
          ) : null}

          {profileQuery.data ? (
            <Card style={styles.card}>
              {profileQuery.data.avatarUrl ? (
                <Image
                  source={{ uri: profileQuery.data.avatarUrl }}
                  accessibilityLabel="Sua foto de perfil"
                  style={styles.avatar}
                />
              ) : null}

              {successMessage ? (
                <View accessibilityRole="alert" style={styles.successBanner}>
                  <Text style={styles.successText}>{successMessage}</Text>
                </View>
              ) : null}

              {!editing ? (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>Nome</Text>
                    <Text style={styles.value}>{profileQuery.data.name ?? 'Não informado'}</Text>
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Email</Text>
                    <Text style={styles.value}>{profileQuery.data.email}</Text>
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Telefone</Text>
                    <Text style={styles.value}>{profileQuery.data.phone ?? 'Não informado'}</Text>
                  </View>
                  <View style={styles.field}>
                    <Text style={styles.label}>Cliente desde</Text>
                    <Text style={styles.value}>{formatDate(profileQuery.data.createdAt)}</Text>
                  </View>
                  <Button variant="outline" onPress={startEditing} testID="profile-edit">
                    Editar nome
                  </Button>
                </>
              ) : (
                <>
                  <Text style={styles.label}>Nome</Text>
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                    autoComplete="given-name"
                    accessibilityLabel="Nome"
                    testID="profile-first-name"
                  />
                  <Text style={styles.label}>Sobrenome</Text>
                  <TextInput
                    style={styles.input}
                    value={lastName}
                    onChangeText={setLastName}
                    autoCapitalize="words"
                    autoComplete="family-name"
                    accessibilityLabel="Sobrenome"
                    testID="profile-last-name"
                  />
                  {formError ? (
                    <Text style={styles.error} accessibilityRole="alert">
                      {formError}
                    </Text>
                  ) : null}
                  <View style={styles.formActions}>
                    <Button
                      variant="ghost"
                      onPress={cancelEditing}
                      disabled={updateProfile.isPending}
                      testID="profile-cancel-edit"
                    >
                      Cancelar
                    </Button>
                    <Button
                      onPress={handleSave}
                      disabled={updateProfile.isPending || !trimmedFirstName || !hasChanges}
                      testID="profile-save"
                    >
                      {updateProfile.isPending ? 'Salvando…' : 'Salvar'}
                    </Button>
                  </View>
                </>
              )}
            </Card>
          ) : null}

          {permissionQuery.data ? (
            <Card style={styles.card}>
              <Text style={styles.sectionTitle}>Notificações</Text>
              {permissionQuery.data.status === 'granted' ? (
                <Text style={styles.hint} testID="notifications-granted">
                  Ativadas — você recebe avisos quando sua reserva é confirmada, o pagamento é
                  aprovado ou uma reserva é cancelada.
                </Text>
              ) : permissionQuery.data.status === 'denied' && !permissionQuery.data.canAskAgain ? (
                <>
                  <Text style={styles.hint} testID="notifications-blocked">
                    Notificações estão bloqueadas nas configurações do sistema para o ArenaHub.
                  </Text>
                  <Button
                    variant="outline"
                    onPress={() => Linking.openSettings()}
                    testID="notifications-open-settings"
                  >
                    Abrir configurações
                  </Button>
                </>
              ) : (
                <>
                  <Text style={styles.hint}>
                    Receba um aviso quando sua reserva for confirmada, o pagamento for aprovado ou
                    uma reserva for cancelada.
                  </Text>
                  <Button
                    variant="outline"
                    onPress={() => requestPermission.mutate()}
                    disabled={requestPermission.isPending}
                    testID="notifications-request-permission"
                  >
                    {requestPermission.isPending ? 'Solicitando…' : 'Ativar notificações'}
                  </Button>
                </>
              )}
            </Card>
          ) : null}

          <Button
            variant="outline"
            testID="profile-sign-out"
            onPress={async () => {
              // Confirma que getToken() continua funcionando com a sessão
              // ativa antes de encerrá-la — mesmo comportamento já validado
              // desde a M1, preservado sem alteração.
              await getToken();
              // M7, item 14 — remove o token de push ANTES de encerrar a
              // sessão (a remoção exige um token de sessão válido); nunca
              // bloqueia o logout se isso falhar (rede indisponível, etc.).
              const pushToken = expoPushTokenQuery.data;
              if (pushToken) {
                try {
                  await removePushToken.mutateAsync({ token: pushToken });
                } catch {
                  // Sem token de sessão depois do signOut, uma nova tentativa
                  // de remoção não seria possível de qualquer forma — o
                  // pior caso é o token continuar associado até ser
                  // reassociado a outro login no mesmo aparelho (autolimpeza
                  // natural, ver PushTokensService.register) ou até o Expo
                  // Push Service reportar DeviceNotRegistered.
                }
              }
              await signOut();
            }}
          >
            Sair
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { gap: spacing.md, paddingBottom: spacing.xl },
  card: { gap: spacing.sm },
  sectionTitle: { fontSize: typography.label.fontSize, fontWeight: '700', color: colors.foreground },
  hint: { fontSize: typography.caption.fontSize, color: colors.mutedForeground },
  avatar: { width: 72, height: 72, borderRadius: 36, alignSelf: 'center', marginBottom: spacing.xs },
  field: { gap: 2 },
  label: { fontSize: typography.label.fontSize, fontWeight: '600', color: colors.foreground },
  value: { fontSize: typography.body.fontSize, color: colors.mutedForeground },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  error: { color: colors.destructive, fontSize: typography.caption.fontSize },
  formActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  successBanner: { backgroundColor: colors.success, borderRadius: radius.lg, padding: spacing.sm },
  successText: { color: colors.successForeground, fontSize: typography.body.fontSize, fontWeight: '600' },
});
