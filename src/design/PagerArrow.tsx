/**
 * The chevron either side of a date heading.
 *
 * Extracted from `RoutinesView`, which had it as a local component, when the
 * chore chart needed the same control for paging weeks. Two copies of a 44pt
 * target is exactly how one of them ends up at 32.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable } from 'react-native';

import { useTheme } from './theme';
import { MIN_TARGET } from './tokens';

export function PagerArrow({
  label,
  glyph,
  onPress,
  disabled = false,
}: {
  label: string;
  glyph: 'chevron-left' | 'chevron-right';
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{
        minWidth: MIN_TARGET,
        minHeight: MIN_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {/*
        An icon rather than a ‹ character: the glyph rendered small and thin at
        every text size, which made a 44pt target look like a 10pt one.
      */}
      <MaterialCommunityIcons name={glyph} size={28} color={colors.textMuted} />
    </Pressable>
  );
}
