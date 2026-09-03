/**
 * Choosing a chore's category and priority.
 *
 * Both are chips rather than a dropdown, because both sets are small and a
 * dropdown hides the options behind a tap. The category set can grow, so it
 * wraps; the priority set is fixed at three and always fits.
 *
 * "Other" is offered as a real-looking option even though it is the *absence*
 * of a category — a null `category_id`. Presenting "no category" as an empty
 * state to opt out of would make the common case feel like a mistake.
 *
 * A category can be created from here. The moment you want one is the moment
 * you are filing a chore and none of the existing names fit — sending someone
 * to a settings screen at that point means abandoning a half-written form, and
 * the usual result is that nobody bothers and everything stays in Other.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { describePriority, PRIORITIES, type Priority } from '@/core/chore/priority';
import { OTHER_TITLE } from '@/core/occurrence/grouping';
import type { Category } from '@/data/api/categories';
import { Button, Field, Txt } from '@/design/components';
import { IconPicker } from '@/features/common/IconPicker';
import type { IconName } from '@/design/icons';
import { FieldGroup } from '@/design/controls';
import { INKS, inkColor, inkSoft } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';

interface Props {
  categories: readonly Category[];
  categoryId: string | null;
  onChangeCategory: (categoryId: string | null) => void;
  priority: Priority;
  onChangePriority: (priority: Priority) => void;
  /**
   * Creates a category and resolves to its id, which is then selected.
   *
   * A callback rather than the mutation itself, so this component stays
   * presentational and testable without standing up a QueryClient.
   */
  onCreateCategory: (input: {
    name: string;
    ink: string | null;
    icon: string | null;
  }) => Promise<string>;
  /** True while a creation is in flight. */
  creating?: boolean;
  /** Surfaced under the inline form — a duplicate name is the common one. */
  createError?: string | null;
}

export function CategoryAndPriorityPicker({
  categories,
  categoryId,
  onChangeCategory,
  priority,
  onChangePriority,
  onCreateCategory,
  creating = false,
  createError = null,
}: Props) {
  const { colors, isDark } = useTheme();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newInk, setNewInk] = useState<string | null>(null);
  const [newIcon, setNewIcon] = useState<IconName | null>(null);

  const submitNew = () => {
    const name = newName.trim();
    if (name.length === 0) return;
    void onCreateCategory({ name, ink: newInk, icon: newIcon }).then((id) => {
      // Selecting it is the point. Creating a category mid-form and then
      // having to find and tap it would be a worse version of the trip to
      // settings this exists to avoid.
      onChangeCategory(id);
      setAdding(false);
      setNewName('');
      setNewInk(null);
      setNewIcon(null);
    });
  };

  return (
    <View style={{ gap: space.xl }}>
      <FieldGroup
        label="Category"
        hint={
          categories.length === 0
            ? 'No categories yet — add one below, or leave this chore in Other.'
            : undefined
        }
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {categories.map((category) => {
            const selected = category.id === categoryId;
            const tint = category.ink === null ? colors.text : inkColor(category.ink, isDark);
            return (
              <Chip
                key={category.id}
                label={category.name}
                selected={selected}
                onPress={() => onChangeCategory(category.id)}
                accessibilityLabel={`Category: ${category.name}`}
                tint={tint}
                wash={category.ink === null ? colors.sunken : inkSoft(category.ink, isDark)}
              />
            );
          })}

          {/* Always last, and always present — it is where a chore lands when
              you do not choose, so it must be reachable to undo a choice. */}
          <Chip
            label={OTHER_TITLE}
            selected={categoryId === null}
            onPress={() => onChangeCategory(null)}
            accessibilityLabel={`Category: ${OTHER_TITLE}`}
            tint={colors.text}
            wash={colors.sunken}
          />

          <Chip
            label={adding ? '× Cancel' : '+ New'}
            selected={false}
            onPress={() => {
              setAdding((open) => !open);
              setNewName('');
              setNewInk(null);
            }}
            accessibilityLabel={adding ? 'Cancel new category' : 'Add a category'}
            tint={colors.text}
            wash={colors.sunken}
          />
        </View>

        {adding ? (
          <View style={{ gap: space.sm, paddingTop: space.sm }}>
            <Field
              label="New category"
              value={newName}
              onChangeText={setNewName}
              placeholder="Kitchen"
              maxLength={40}
              autoFocus
              {...(createError === null ? {} : { error: createError })}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {INKS.map((option) => {
                const selected = newInk === option.name;
                return (
                  <Pressable
                    key={option.name}
                    onPress={() => setNewInk(selected ? null : option.name)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Colour: ${option.label}`}
                    style={{
                      minWidth: 44,
                      minHeight: MIN_TARGET,
                      borderRadius: radius.sm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: inkSoft(option.name, isDark),
                      borderWidth: selected ? 2 : 0,
                      borderColor: inkColor(option.name, isDark),
                    }}
                  >
                    <View
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 8,
                        backgroundColor: inkColor(option.name, isDark),
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>

            <IconPicker value={newIcon} onChange={setNewIcon} />

            <Button
              label="Add category"
              onPress={submitNew}
              loading={creating}
              disabled={newName.trim().length === 0}
            />
          </View>
        ) : null}
      </FieldGroup>

      <FieldGroup label="Priority" hint="Sorts the chore within whatever it is grouped by.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {PRIORITIES.map((level) => (
            <Chip
              key={level}
              label={describePriority(level)}
              selected={level === priority}
              onPress={() => onChangePriority(level)}
              accessibilityLabel={`Priority: ${describePriority(level)}`}
              tint={colors.text}
              wash={colors.sunken}
            />
          ))}
        </View>
      </FieldGroup>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  tint,
  wash,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  tint: string;
  wash: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      style={{
        minHeight: MIN_TARGET,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.sm,
        backgroundColor: selected ? tint : wash,
      }}
    >
      <Txt
        variant="small"
        style={{
          color: selected ? colors.surface : colors.textMuted,
          fontWeight: selected ? '700' : '500',
        }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
