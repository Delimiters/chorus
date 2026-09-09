/**
 * Choosing an icon for a chore.
 *
 * Grouped and collapsed. The full set is sixty-odd glyphs, which is a wall if
 * shown at once and a search problem if shown behind a filter — so the row
 * shows the current choice and opens a grouped grid on demand. Most chores
 * will never have one, and "None" is the honest default rather than a
 * placeholder icon that means nothing.
 *
 * The icons come from a font, not a native module, so this whole feature is a
 * JavaScript change. See src/design/icons.ts for the licence position and for
 * why the import below uses the subpath.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { ICON_GROUPS, type IconName } from '@/design/icons';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';

interface Props {
  value: IconName | null;
  onChange: (value: IconName | null) => void;
  /**
   * The field's heading. "Icon" unless it would collide with another one.
   *
   * The chore form nests one of these inside the new-category fields, directly
   * above its own — two "ICON" headings in a column, for two different things.
   */
  label?: string;
  /**
   * Called when the grid closes, so the form can scroll back to this control.
   *
   * The grid is sixty-odd glyphs tall. Choosing one closes it, the content
   * above the scroll position shrinks by that much, and the offset stays put —
   * which lands you somewhere near the bottom of the form having chosen an
   * icon. See src/features/common/FormScroll.tsx.
   */
  onCollapse?: () => void;
}

export function IconPicker({ value, onChange, label = 'Icon', onCollapse }: Props) {
  const { colors } = useTheme();
  const lower = label.toLowerCase();
  const article = /^[aeiou]/.test(lower) ? 'an' : 'a';
  const [open, setOpen] = useState(false);

  const close = () => {
    setOpen(false);
    onCollapse?.();
  };

  return (
    <FieldGroup label={label}>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Pressable
            onPress={() => (open ? close() : setOpen(true))}
            accessibilityRole="button"
            /*
              Follows the heading. With the chore form's new-category fields
              open there are two of these on screen, and a screen reader
              announcing "Choose an icon" twice cannot say which is which.
            */
            accessibilityLabel={open ? `Close the ${lower} list` : `Choose ${article} ${lower}`}
            style={{
              minHeight: MIN_TARGET,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              paddingHorizontal: space.md,
              borderRadius: radius.sm,
              backgroundColor: colors.sunken,
            }}
          >
            {value === null ? null : (
              <MaterialCommunityIcons name={value} size={20} color={colors.text} />
            )}
            <Txt variant="small" tone="muted">
              {open ? '× Close' : value === null ? `Choose ${article} ${lower}` : 'Change'}
            </Txt>
          </Pressable>

          {value === null ? null : (
            <Pressable
              onPress={() => onChange(null)}
              accessibilityRole="button"
              accessibilityLabel="Remove the icon"
              style={{
                minHeight: MIN_TARGET,
                justifyContent: 'center',
                paddingHorizontal: space.sm,
              }}
            >
              <Txt variant="small" tone="faint">
                Remove
              </Txt>
            </Pressable>
          )}
        </View>

        {open ? (
          <View style={{ gap: space.md }}>
            {ICON_GROUPS.map((group) => (
              <View key={group.title} style={{ gap: space.xs }}>
                <Txt variant="label" tone="faint">
                  {group.title}
                </Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  {group.icons.map((icon) => {
                    const selected = icon === value;
                    return (
                      <Pressable
                        key={icon}
                        onPress={() => {
                          onChange(icon);
                          close();
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        // The icon *is* the choice here, so it needs a real
                        // label rather than being treated as decoration.
                        accessibilityLabel={icon.replace(/-/g, ' ')}
                        style={{
                          width: MIN_TARGET,
                          height: MIN_TARGET,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: radius.sm,
                          backgroundColor: selected ? colors.text : colors.sunken,
                        }}
                      >
                        <MaterialCommunityIcons
                          name={icon}
                          size={22}
                          color={selected ? colors.surface : colors.textMuted}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </FieldGroup>
  );
}
