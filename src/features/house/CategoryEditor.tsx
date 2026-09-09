/**
 * One category, on its own screen.
 *
 * This was an inline block pinned to the bottom of the categories list, and
 * pressing "Edit" on a row simply filled it in. With more than a screenful of
 * categories the form was below the fold, so the button looked broken — Jake:
 * *"the categories tab no longer lets me edit a category. The button just does
 * nothing. Wait actually I see what's happening, the editor is just inline at
 * the bottom, but if there are a bunch of categories you can't even tell
 * anything is happening."*
 *
 * A pushed screen also gives the two things the inline form could not: a title
 * that says which category you are editing, and a back gesture that means
 * cancel.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories, useCreateCategory, useUpdateCategory } from '@/data/hooks/useCategories';
import { BackBar, Button, ErrorState, Field, LoadingState, Stack, Txt } from '@/design/components';
import { FieldGroup } from '@/design/controls';
import { INKS, inkColor, inkSoft } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';
import { IconPicker } from '@/features/common/IconPicker';
import { toIconName, type IconName } from '@/design/icons';

interface Props {
  /** `null` creates a new one. */
  readonly categoryId: string | null;
}

export function CategoryEditor({ categoryId }: Props) {
  const { isDark, colors } = useTheme();
  const router = useRouter();
  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();

  const existing = (categories.data ?? []).find((c) => c.id === categoryId);

  /*
   * Seeded once from the loaded category rather than kept in sync with it.
   *
   * Re-seeding on every render would discard what is being typed the moment a
   * refetch lands.
   */
  const [seeded, setSeeded] = useState(false);
  const [name, setName] = useState('');
  const [ink, setInk] = useState<string | null>(null);
  const [icon, setIcon] = useState<IconName | null>(null);

  if (categoryId !== null && existing !== undefined && !seeded) {
    setSeeded(true);
    setName(existing.name);
    setInk(existing.ink);
    setIcon(toIconName(existing.icon));
  }

  // Editing something that has not arrived yet: waiting beats opening an empty
  // form, which looks like a new category and saves as a duplicate.
  if (categoryId !== null && existing === undefined) {
    if (categories.isLoading) return <LoadingState />;
    return <ErrorState message="That category no longer exists." />;
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/categories'));

  const save = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    if (categoryId === null) {
      create.mutate({ name: trimmed, ink, icon }, { onSuccess: close });
    } else {
      update.mutate({ categoryId, name: trimmed, ink, icon }, { onSuccess: close });
    }
  };

  const busy = create.isPending || update.isPending;
  const error =
    (create.error as Error | null)?.message ?? (update.error as Error | null)?.message ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}>
        <BackBar onPress={close} />

        <Txt variant="display" accessibilityRole="header">
          {categoryId === null ? 'New category' : 'Edit category'}
        </Txt>

        <Stack gap={space.md} style={{ paddingTop: space.md }}>
          <Field
            label="Name"
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
                      minWidth: MIN_TARGET,
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
          </FieldGroup>

          <IconPicker value={icon} onChange={setIcon} />

          <Button
            label={categoryId === null ? 'Add category' : 'Save changes'}
            onPress={save}
            loading={busy}
            disabled={name.trim().length === 0}
          />
          <Button label="Cancel" variant="ghost" onPress={close} />

          {error === null ? null : (
            <Txt variant="small" tone="danger">
              {error}
            </Txt>
          )}
        </Stack>
      </ScrollView>
    </SafeAreaView>
  );
}
