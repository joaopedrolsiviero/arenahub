import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSignUp } from '@clerk/clerk-expo';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/constants/theme';

// Mesmo espírito de sign-in.tsx: fluxo mínimo real, só email/senha. Clerk
// exige verificação por código de email por padrão — o formulário tem duas
// etapas (criar conta -> confirmar código), nunca inventado: é o fluxo
// documentado do próprio `useSignUp()`. `redirect` (M3) segue o mesmo
// contrato de sign-in.tsx.
export default function SignUpScreen() {
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const { signUp, setActive, isLoaded } = useSignUp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreateAccount() {
    if (!isLoaded) return;
    setError(null);
    setSubmitting(true);
    try {
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch {
      setError('Não foi possível criar a conta. Verifique os dados e tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify() {
    if (!isLoaded) return;
    setError(null);
    setSubmitting(true);
    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
        router.replace(redirect ? decodeURIComponent(redirect) : '/(tabs)');
      } else {
        setError('Código inválido.');
      }
    } catch {
      setError('Código inválido ou expirado.');
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingVerification) {
    return (
      <Screen>
        <View style={styles.form}>
          <Text style={styles.label}>Código enviado para {email}</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            testID="sign-up-code"
          />
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button onPress={handleVerify} disabled={submitting} testID="sign-up-verify">
            {submitting ? 'Confirmando…' : 'Confirmar código'}
          </Button>
        </View>
      </Screen>
    );
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
          testID="sign-up-email"
        />
        <Text style={styles.label}>Senha</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password-new"
          testID="sign-up-password"
        />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <Button onPress={handleCreateAccount} disabled={!isLoaded || submitting} testID="sign-up-submit">
          {submitting ? 'Criando conta…' : 'Criar conta'}
        </Button>
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
});
