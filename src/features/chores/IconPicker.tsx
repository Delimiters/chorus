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
import { radius, space } from '@/design/tokens';

interface Props {
  value: IconName | null;
  onChange: (value: IconName | null) => void;
}

export function IconPicker({ value, onChange }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <FieldGroup label="Icon">
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Pressable
            onPress={() => setOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={open ? 'Close the icon list' : 'Choose an icon'}
            style={{
              minHeight: 44,
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
              {open ? '× Close' : value === null ? 'Choose an icon' : 'Change'}
            </Txt>
          </Pressable>

          {value === null ? null : (
            <Pressable
              onPress={() => onChange(null)}
              accessibilityRole="button"
              accessibilityLabel="Remove the icon"
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm }}
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
                          setOpen(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        // The icon *is* the choice here, so it needs a real
                        // label rather than being treated as decoration.
                        accessibilityLabel={icon.replace(/-/g, ' ')}
                        style={{
                          width: 44,
                          height: 44,
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
