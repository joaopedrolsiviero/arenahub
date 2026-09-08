import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { useSignIn } from '@clerk/clerk-expo';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/constants/theme';

// Fluxo mínimo real (item 10 do prompt: "valide pelo menos renderização,
// inicialização, sessão, obtenção de token" — não um placeholder estático).
// Só email/senha — nenhum provedor social/OAuth (Seção 11: sem confirmação
// de que o projeto Clerk usa OAuth, nenhum deep link é configurado nesta
// fase; ver relatório final). `@clerk/clerk-expo` não tem um componente
// pronto equivalente ao <SignIn/> do Web — o formulário é sempre construído
// à mão contra `useSignIn()`, isso é o SDK oficial, nunca uma autenticação
// própria.
//
// M3 — `redirect` (path + query já codificados, montado por quem navegou
// pra cá, ex: BookingSummaryCard) é pra onde volta depois do login; sem
// ele, volta pra Início — mesma convenção de `redirect_url` do Clerk Web,
// só que resolvida à mão aqui (o SDK Expo não tem esse mecanismo pronto).
export default function SignInScreen() {
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    if (!isLoaded) return;
    setError(null);
    setSubmitting(true);
    try {
      const attempt = await signIn.create({ identifier: email, password });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
        router.replace(redirect ? decodeURIComponent(redirect) : '/(tabs)');
      } else {
        // Fluxos com etapa adicional (ex: verificação) ficam para quando a
        // fase de reserva/perfil exigir — nesta fundação, só o caminho feliz
        // de email/senha precisa funcionar.
        setError('Não foi possível concluir o login com essas credenciais.');
      }
    } catch {
      setError('Email ou senha incorretos.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.form}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          testID="sign-in-email"
        />
        <Text style={styles.label}>Senha</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          testID="sign-in-password"
        />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button onPress={handleSignIn} disabled={!isLoaded || submitting} testID="sign-in-submit">
          {submitting ? 'Entrando…' : 'Entrar'}
        </Button>
        {/* `redirect` já chega aqui como string codificada (a própria
            query-string desta tela) — repassada como está, nunca
            codificada de novo (double-encoding quebraria o decode em
            sign-up.tsx). */}
        <Link
          href={redirect ? `/(auth)/sign-up?redirect=${redirect}` : '/(auth)/sign-up'}
          style={styles.link}
        >
          Não tem conta? Criar conta
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm, paddingTop: spacing.lg },
  label: { fontSize: typography.label.fontSize, fontWeight: '600', color: colors.foreground },
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
  link: {
    textAlign: 'center',
    color: colors.mutedForeground,
    fontSize: typography.caption.fontSize,
    marginTop: spacing.sm,
  },
});
