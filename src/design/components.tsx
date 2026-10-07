/**
 * The component primitives Phase 4 needs.
 *
 * Kept deliberately small — Phase 5 builds out the full kit (Card, Sheet, Chip,
 * ListRow, Avatar, Skeleton). These are the ones auth and onboarding require, and
 * they establish the patterns the rest will follow.
 */

import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
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

import { tapped } from './haptics';
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
  /**
   * What a screen reader says instead of the text.
   *
   * For when the visible text is only part of the fact — a section heading
   * whose count is rendered as a separate node beside it, so unlabelled it is
   * announced as "Chores" and then a bare "3".
   */
  accessibilityLabel?: string;
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
  accessibilityLabel,
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
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
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
  /**
   * `danger` is for actions that destroy something and cannot be undone.
   *
   * Filled rather than outlined, because it should be as legible as the
   * primary action it sits near — an irreversible button that reads as a
   * secondary one is a trap.
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
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
    variant === 'primary'
      ? colors.text
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.sunken
          : 'transparent';
  const foreground = variant === 'primary' || variant === 'danger' ? colors.surface : colors.text;

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

/**
 * How close to `maxLength` the countdown appears.
 *
 * A quarter of the field, capped at twenty characters. A flat twenty would mean
 * the nine-character invite code counts down from the moment you start typing,
 * and a flat quarter would put a counter on the 2000-character notes field 500
 * characters early. Both read as nagging.
 */
function countdownFrom(maxLength: number): number {
  return Math.min(20, Math.ceil(maxLength / 4));
}

export function Field({ label, error, hint, inputStyle, ...rest }: FieldProps) {
  const colors = useColors();

  /*
   * What happens when you run out of room.
   *
   * Emily hit the end of a chore name and the field just stopped accepting
   * keystrokes — nothing moved, nothing said why, and a key that does nothing
   * reads as a broken keyboard rather than a full field. `maxLength` is what
   * makes that silence: React Native clips the text before `onChangeText` ever
   * fires, so there is no event to react to and the only honest fix is to say
   * where the boundary is *before* you arrive at it.
   *
   * Three states, and the limit is deliberately **not** drawn as an error: the
   * border stays neutral and the copy does not apologise. Nothing is wrong —
   * the field is simply full, which is a fact about the field and not a mistake
   * you made.
   */
  const maxLength = rest.maxLength;
  const length = typeof rest.value === 'string' ? rest.value.length : 0;
  const remaining = maxLength === undefined ? null : maxLength - length;
  const full = remaining === 0;
  const counting =
    maxLength !== undefined && remaining !== null && remaining > 0
      ? remaining <= countdownFrom(maxLength)
      : false;

  /*
   * Buzzes when you *arrive* at the limit — not on every keystroke there, and
   * not when a field is already full the moment it appears.
   *
   * The first run is skipped deliberately. A field seeded from existing data can
   * mount at its cap — open a note whose title is exactly 120 characters, or
   * edit a chore named right up to 200 — and buzzing the phone and interrupting
   * a screen reader for a limit the reader did not just hit is startling and
   * meaningless. `wasFull` starting as `null` is what distinguishes "mounted
   * full" from "just became full".
   *
   * The ref is read and written inside the effect, never during render: a ref
   * written during render makes the React Compiler bail out of this whole
   * function, silently.
   */
  const wasFull = useRef<boolean | null>(null);
  useEffect(() => {
    const first = wasFull.current === null;
    wasFull.current = full;
    if (first || !full) return;
    tapped();
    // Nothing visual reaches a screen reader here — the counter is not focused
    // and the input's value has stopped changing — so the limit is spoken.
    AccessibilityInfo.announceForAccessibility(`Full at ${String(maxLength)} characters`);
  }, [full, maxLength]);

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
      {/*
        One row, so a hint and a countdown cannot fight over the same line and
        push the fields below them around as you type. The row is only rendered
        when it has something in it — an empty one would add permanent space
        under every field in the app.
      */}
      {error !== undefined || full || hint !== undefined || counting ? (
        <View
          testID="field-footer"
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}
        >
          <View style={{ flex: 1 }}>
            {error !== undefined ? (
              <Txt variant="small" tone="danger">
                {error}
              </Txt>
            ) : full ? (
              /*
                No label in the sentence.
                
                It read "That's the longest a ${label.toLowerCase()} can be",
                which produced "a notes", "a invite code" and "a household" —
                three of the nine capped fields in the app. An article cannot be
                derived from a label, and the label is already on screen
                directly above this line, so the sentence says the thing the
                label cannot: why the keyboard stopped doing anything.
              */
              <Txt variant="small">{`You've used all ${String(maxLength)} characters — that's the limit.`}</Txt>
            ) : hint !== undefined ? (
              <Txt variant="small" tone="faint">
                {hint}
              </Txt>
            ) : null}
          </View>
          {counting ? <Txt variant="small" tone="faint">{`${String(remaining)} left`}</Txt> : null}
        </View>
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

/**
 * A back control for a pushed screen.
 *
 * Every screen under `(app)` is rendered with `headerShown: false`, so there is
 * no navigation chrome at all — and swiping from the left edge is an invisible
 * affordance that assumes the person already knows iOS. The chore form did have
 * a Cancel, but at the *bottom* of a long scrolling form, past recurrence and
 * assignment; Settings and Categories had nothing.
 *
 * Rendered as text rather than a bare chevron so it is unambiguous, and sized
 * to the minimum touch target rather than to the glyph.
 */
export function BackBar({
  label = 'Back',
  onPress,
}: {
  /** "Cancel" on a form, where leaving discards work; "Back" elsewhere. */
  label?: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row' }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        style={{
          minHeight: MIN_TARGET,
          justifyContent: 'center',
          paddingRight: space.md,
        }}
      >
        <Txt variant="body" style={{ color: colors.textMuted }}>
          {`‹  ${label}`}
        </Txt>
      </Pressable>
    </View>
  );
}
