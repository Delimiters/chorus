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

import { useRouter } from 'expo-router';
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
import { BackBar, Button, ErrorState, Field, LoadingState, Stack, Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { INKS, inkColor, inkSoft } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { ReorderableList } from './ReorderableList';
import { IconPicker } from '@/features/chores/IconPicker';
import { toIconName, type IconName } from '@/design/icons';

export function CategoriesScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const reorder = useReorderCategories();

  const [name, setName] = useState('');
  const [ink, setInk] = useState<string | null>(null);
  const [icon, setIcon] = useState<IconName | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * The ScrollView must stop scrolling while a row is held.
   *
   * Otherwise the drag and the scroll compete for the same vertical movement
   * and the row slips out from under the finger.
   */
  const [dragging, setDragging] = useState(false);

  const rows = categories.data ?? [];

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setName(category.name);
    setInk(category.ink);
    setIcon(toIconName(category.icon));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setName('');
    setInk(null);
    setIcon(null);
  };

  const save = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    if (editingId === null) {
      create.mutate({ name: trimmed, ink, icon }, { onSuccess: cancelEdit });
    } else {
      update.mutate({ categoryId: editingId, name: trimmed, ink, icon }, { onSuccess: cancelEdit });
    }
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
        scrollEnabled={!dragging}
      >
        <BackBar onPress={() => (router.canGoBack() ? router.back() : router.replace('/house'))} />

        <Txt variant="display" accessibilityRole="header">
          Categories
        </Txt>
        <Txt variant="small" tone="faint">
          Group chores by the kind of thing they are. Anything without a category shows up under “
          {OTHER_TITLE}”.
        </Txt>

        {error === null ? null : <ErrorState message={error} />}

        <ReorderableList
          items={rows}
          keyOf={(c) => c.id}
          labelOf={(c) => c.name}
          onReorder={(orderedIds) => reorder.mutate({ orderedIds })}
          onDragStateChange={setDragging}
          renderItem={(category, isDragging) => (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.sm,
                paddingVertical: space.xs,
                marginVertical: 2,
                borderRadius: radius.md,
                backgroundColor: isDragging ? colors.raised : colors.sunken,
              }}
            >
              {/* A grip, so "you can pick this up" is visible rather than
                  something you have to already know. */}
              <View accessibilityElementsHidden importantForAccessibility="no">
                <Txt variant="small" tone="faint">
                  ☰
                </Txt>
              </View>
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
          )}
        />

        <Stack gap={space.md}>
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

          <IconPicker value={icon} onChange={setIcon} />

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
