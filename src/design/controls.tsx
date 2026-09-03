/**
 * Form controls for the chore builder.
 *
 * All of them are plain React Native — no picker library, no modal library. The
 * builder needs a segmented control, a small number stepper, and a row of
 * toggles, and those are less code than the wiring a dependency would need.
 * Fewer native modules also means the app keeps running in Expo Go, which is the
 * only place it can run on this machine at all. See docs/POSTMORTEM-SWIFT.md.
 */

import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from './components';
import { useTheme } from './theme';
import { MIN_TARGET, radius, space } from './tokens';

// ── Segmented control ───────────────────────────────────────────────────────

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Lets a long set scroll rather than crushing every label to two letters. */
  scrollable?: boolean;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  scrollable = false,
}: SegmentedProps<T>) {
  const { colors } = useTheme();

  const row = (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        backgroundColor: colors.sunken,
        borderRadius: radius.md,
        padding: 3,
        gap: 3,
      }}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            onPress={() => onChange(segment.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={segment.label}
            style={{
              flex: scrollable ? undefined : 1,
              paddingHorizontal: scrollable ? space.md : space.sm,
              paddingVertical: 9,
              borderRadius: radius.sm,
              alignItems: 'center',
              backgroundColor: selected ? colors.surface : 'transparent',
            }}
          >
            <Txt
              variant="small"
              style={{
                color: selected ? colors.text : colors.textMuted,
                fontWeight: selected ? '700' : '500',
              }}
            >
              {segment.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) return row;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {row}
    </ScrollView>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────────

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  /** Rendered beside the number: "every [3] weeks". */
  unit?: (value: number) => string;
}

/**
 * A small number, changed by tapping.
 *
 * A text field would open the keyboard for a value that is nearly always
 * between one and four, and would need parsing, validation, and an empty state.
 * Two buttons need none of that and cannot produce an invalid value.
 */
export function Stepper({ value, onChange, min = 1, max = 30, label, unit }: StepperProps) {
  const { colors } = useTheme();
  const atMin = value <= min;
  const atMax = value >= max;

  const button = (delta: number, disabled: boolean, symbol: string, action: string) => (
    <Pressable
      onPress={() => onChange(Math.min(max, Math.max(min, value + delta)))}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${action} ${label}`}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={{
        width: 34,
        height: 34,
        borderRadius: radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.sunken,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Txt variant="bodyStrong" style={{ color: colors.text, lineHeight: 20 }}>
        {symbol}
      </Txt>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {button(-1, atMin, '−', 'Decrease')}
      <View
        accessibilityLabel={`${label}: ${value}`}
        style={{ minWidth: 76, alignItems: 'center' }}
      >
        <Txt variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {unit ? unit(value) : value}
        </Txt>
      </View>
      {button(1, atMax, '+', 'Increase')}
    </View>
  );
}

// ── Toggle chips ────────────────────────────────────────────────────────────

interface TogglesProps<T extends string | number> {
  options: readonly { value: T; label: string; a11yLabel?: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  label: string;
}

/**
 * A row of independently selectable chips — the weekday picker, mostly.
 *
 * `checkbox` rather than `radio`, because more than one can be on at once and a
 * screen reader announcing "radio button" for a multi-select is a lie.
 */
export function ToggleChips<T extends string | number>({
  options,
  selected,
  onToggle,
  label,
}: TogglesProps<T>) {
  const { colors } = useTheme();

  return (
    <View
      accessibilityLabel={label}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}
    >
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onToggle(option.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={option.a11yLabel ?? option.label}
            style={{
              minWidth: MIN_TARGET,
              minHeight: MIN_TARGET,
              paddingHorizontal: space.sm,
              borderRadius: radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? colors.text : colors.sunken,
            }}
          >
            <Txt
              variant="small"
              style={{
                color: on ? colors.surface : colors.textMuted,
                fontWeight: on ? '700' : '500',
              }}
            >
              {option.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Option row ──────────────────────────────────────────────────────────────

interface OptionRowProps {
  title: string;
  subtitle?: string | undefined;
  selected: boolean;
  onPress: () => void;
  /** A small mark on the left — the assignee's ink, usually. */
  accessory?: React.ReactNode;
}

/** A single-choice row, for lists too long or too wordy for a segmented control. */
export function OptionRow({ title, subtitle, selected, onPress, accessory }: OptionRowProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle === undefined ? title : `${title}. ${subtitle}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: MIN_TARGET,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.md,
        backgroundColor: selected ? colors.sunken : 'transparent',
        borderWidth: 1,
        borderColor: selected ? colors.text : 'transparent',
      }}
    >
      {accessory}
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant={selected ? 'bodyStrong' : 'body'}>{title}</Txt>
        {subtitle === undefined ? null : (
          <Txt variant="small" tone="faint">
            {subtitle}
          </Txt>
        )}
      </View>
      {/* A tick, not a colour change — colour is never the only signal. */}
      {selected ? <Txt variant="bodyStrong">✓</Txt> : null}
    </Pressable>
  );
}

// ── Field group ─────────────────────────────────────────────────────────────

/** A labelled section of a form. */
export function FieldGroup({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle> | undefined;
}) {
  return (
    <View style={[{ gap: space.xs }, style]}>
      <Txt variant="label" tone="faint">
        {label}
      </Txt>
      {children}
      {hint === undefined ? null : (
        <Txt variant="small" tone="faint">
          {hint}
        </Txt>
      )}
    </View>
  );
}
