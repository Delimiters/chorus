/**
 * Managing categories: add, rename, recolour, reorder, delete.
 *
 * Reordering is buttons rather than drag-and-drop. Drag would need
 * `react-native-gesture-handler` wired into a reorderable list, and this is a
 * list of maybe six rows that changes about twice a year — the same reasoning
 * that kept the date picker off the community package (docs/RELEASE.md). Up and
 * down arrows are also the accessible option by default, where a drag handle
 * needs an explicit alternative built for it.
 *
 * "Other" does not appear here, because it is not a category — it is the
 * absence of one, and there is nothing to rename or delete.
 */

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OTHER_TITLE } from '@/core/occurrence/grouping';
import type { Category } from '@/data/api/categories';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useReorderCategories,
  useUpdateCategory,
} from '@/data/hooks/useCategories';
import { Button, ErrorState, Field, LoadingState, Stack, Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { INKS, inkColor, inkSoft } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export function CategoriesScreen() {
  const { colors, isDark } = useTheme();
  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const reorder = useReorderCategories();

  const [name, setName] = useState('');
  const [ink, setInk] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const rows = categories.data ?? [];

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setName(category.name);
    setInk(category.ink);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName('');
    setInk(null);
  };

  const save = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    if (editingId === null) {
      create.mutate({ name: trimmed, ink }, { onSuccess: cancelEdit });
    } else {
      update.mutate({ categoryId: editingId, name: trimmed, ink }, { onSuccess: cancelEdit });
    }
  };

  /**
   * Moves a row one place and rewrites the whole order.
   *
   * The mutation is optimistic, so the list settles immediately rather than
   * waiting on a round trip per tap — which matters when moving something
   * three places means three taps.
   */
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    reorder.mutate({ orderedIds: next.map((c) => c.id) });
  };

  const busy = create.isPending || update.isPending;
  const error =
    (create.error as Error | null)?.message ??
    (update.error as Error | null)?.message ??
    (remove.error as Error | null)?.message ??
    (reorder.error as Error | null)?.message ??
    null;

  if (categories.isPending) return <LoadingState label="Loading categories" />;
  if (categories.isError) {
    return <ErrorState message={(categories.error as Error).message} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Txt variant="display" accessibilityRole="header">
          Categories
        </Txt>
        <Txt variant="small" tone="faint">
          Group chores by the kind of thing they are. Anything without a category shows up under “
          {OTHER_TITLE}”.
        </Txt>

        {error === null ? null : <ErrorState message={error} />}

        <Stack gap={space.md}>
          {rows.map((category, index) => (
            <View
              key={category.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                padding: space.sm,
                borderRadius: radius.md,
                backgroundColor: colors.sunken,
              }}
            >
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor:
                    category.ink === null ? colors.textMuted : inkColor(category.ink, isDark),
                }}
              />
              <Txt style={{ flex: 1 }}>{category.name}</Txt>

              <ArrowButton
                label={`Move ${category.name} up`}
                glyph="▲"
                disabled={index === 0}
                onPress={() => move(index, -1)}
              />
              <ArrowButton
                label={`Move ${category.name} down`}
                glyph="▼"
                disabled={index === rows.length - 1}
                onPress={() => move(index, 1)}
              />
              <Pressable
                onPress={() => startEdit(category)}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${category.name}`}
                style={{ minHeight: 40, minWidth: 40, justifyContent: 'center' }}
              >
                <Txt variant="small" tone="muted">
                  Edit
                </Txt>
              </Pressable>
              <Pressable
                onPress={() => remove.mutate({ categoryId: category.id })}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${category.name}`}
                style={{ minHeight: 40, minWidth: 40, justifyContent: 'center' }}
              >
                <Txt variant="small" tone="danger">
                  Delete
                </Txt>
              </Pressable>
            </View>
          ))}

          {rows.length === 0 ? (
            <Txt variant="small" tone="faint">
              No categories yet. Add one below.
            </Txt>
          ) : null}
        </Stack>

        <Stack gap={space.md}>
          <Field
            label={editingId === null ? 'New category' : 'Rename category'}
            value={name}
            onChangeText={setName}
            placeholder="Kitchen"
            maxLength={40}
          />

          <FieldGroup label="Colour">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {INKS.map((option) => {
                const selected = ink === option.name;
                return (
                  <Pressable
                    key={option.name}
                    onPress={() => setInk(selected ? null : option.name)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
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
          </FieldGroup>

          <Button
            label={editingId === null ? 'Add category' : 'Save changes'}
            onPress={save}
            loading={busy}
            disabled={name.trim().length === 0}
          />
          {editingId === null ? null : (
            <Button label="Cancel" variant="ghost" onPress={cancelEdit} />
          )}
        </Stack>

        <Txt variant="small" tone="faint">
          Deleting a category keeps its chores — they move to “{OTHER_TITLE}”.
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

function ArrowButton({
  label,
  glyph,
  disabled,
  onPress,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onPress: () => void;
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
        minHeight: 40,
        minWidth: 40,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <Txt variant="small" style={{ color: colors.textMuted }}>
        {glyph}
      </Txt>
    </Pressable>
  );
}
