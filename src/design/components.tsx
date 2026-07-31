/**
 * The component primitives Phase 4 needs.
 *
 * Kept deliberately small — Phase 5 builds out the full kit (Card, Sheet, Chip,
 * ListRow, Avatar, Skeleton). These are the ones auth and onboarding require, and
 * they establish the patterns the rest will follow.
 */

import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useColors } from './theme';
import { MIN_TARGET, radius, space, type } from './tokens';

// ── Text ────────────────────────────────────────────────────────────────────

type Variant = keyof typeof type;
type Tone = 'default' | 'muted' | 'faint' | 'danger' | 'accent';

interface TxtProps {
  children: React.ReactNode;
  variant?: Variant;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text';
  /** For text worth copying — an error message, an invite code. */
  selectable?: boolean;
}

export function Txt({
  children,
  variant = 'body',
  tone = 'default',
  style,
  numberOfLines,
  accessibilityRole,
  selectable,
}: TxtProps) {
  const colors = useColors();
  const color =
    tone === 'muted'
      ? colors.textMuted
      : tone === 'faint'
        ? colors.textFaint
        : tone === 'danger'
          ? colors.danger
          : tone === 'accent'
            ? colors.inkA
            : colors.text;

  return (
    <Text
      style={[type[variant] as TextStyle, { color }, style]}
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      selectable={selectable}
    >
      {children}
    </Text>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  ...rest
}: ButtonProps) {
  const colors = useColors();
  const inactive = disabled || loading;

  const background =
    variant === 'primary' ? colors.text : variant === 'secondary' ? colors.sunken : 'transparent';
  const foreground = variant === 'primary' ? colors.surface : colors.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        {
          minHeight: MIN_TARGET,
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space.sm,
          backgroundColor: background,
          // Pressed and disabled are distinguished by opacity rather than a
          // separate colour, so the two states can't be confused.
          opacity: inactive ? 0.45 : pressed ? 0.8 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator size="small" color={foreground} /> : null}
      <Text style={[type.bodyStrong as TextStyle, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

// ── Field ───────────────────────────────────────────────────────────────────

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  /** Extra styling for the input itself — e.g. mono for an invite code. */
  inputStyle?: StyleProp<TextStyle> | undefined;
}

export function Field({ label, error, hint, inputStyle, ...rest }: FieldProps) {
  const colors = useColors();

  return (
    <View style={{ gap: space.xs }}>
      <Text style={[type.label as TextStyle, { color: colors.textFaint }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        style={[
          type.body as TextStyle,
          {
            minHeight: MIN_TARGET,
            color: colors.text,
            backgroundColor: colors.sunken,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: error === undefined ? colors.rule : colors.danger,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
          },
          inputStyle,
        ]}
        {...rest}
      />
      {error !== undefined ? (
        <Txt variant="small" tone="danger">
          {error}
        </Txt>
      ) : hint !== undefined ? (
        <Txt variant="small" tone="faint">
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

/** A vertical stack. Uses `gap`, so no margin collapsing to reason about. */
export function Stack({
  children,
  gap = space.md,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

/** A full-screen error state with a retry affordance. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md }}>
      <Txt variant="heading">Something went wrong</Txt>
      <Txt tone="muted">{message}</Txt>
      {onRetry !== undefined ? (
        <Button label="Try again" onPress={onRetry} variant="secondary" />
      ) : null}
    </View>
  );
}

/** Centred spinner for a screen that is still resolving. */
export function LoadingState({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
      <ActivityIndicator color={colors.inkA} />
      {label !== undefined ? (
        <Txt variant="small" tone="faint">
          {label}
        </Txt>
      ) : null}
    </View>
  );
}
