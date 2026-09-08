import { Pressable, Text, StyleSheet, type GestureResponderEvent } from 'react-native';
import { colors, radius, spacing, typography } from '@/constants/theme';

type ButtonVariant = 'primary' | 'outline' | 'ghost';

// Mesmas três variantes que o Web usa nos CTAs de descoberta pública
// (buttonVariants: default/outline) — "ghost" cobre o caso de ação
// secundária discreta (ex: "Voltar"). `disabled` reduz opacidade em vez de
// trocar de cor, mesmo sinal visual em qualquer variante.
export function Button({
  children,
  onPress,
  variant = 'primary',
  disabled = false,
  testID,
}: {
  children: string;
  onPress?: (event: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.label, variantTextStyles[variant]]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.brand },
  outline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
});

const variantTextStyles = StyleSheet.create({
  primary: { color: colors.brandForeground },
  outline: { color: colors.foreground },
  ghost: { color: colors.mutedForeground },
});
