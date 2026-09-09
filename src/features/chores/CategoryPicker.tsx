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
 *
 * **Creating one has no confirm step.** It used to end in an "Add category"
 * button, which was a second save on a screen that already has one, and which
 * did the creation immediately — so backing out of the chore left the category
 * behind. Jake: *"we don't need the 'Add category' button to save it, if I'm
 * adding a new category for that chore just let me fill in the info and then
 * when I save the chore itself you can add the category and assign that chore
 * to it."* The fields are now a draft the chore form owns and writes on save.
 *
 * **Category and priority are two components, not one.** They were a pair
 * because they render as adjacent chip rows, which is a fact about their looks
 * rather than about the form: filing a chore under a category adopts that
 * category's icon, so the icon picker has to sit *between* them for the choice
 * to be visible when it happens. Jake: *"since icon gets auto selected by
 * category, you should be able to pick the category first."*
 */

import { Pressable, View } from 'react-native';

import { describePriority, PRIORITIES, type Priority } from '@/core/chore/priority';
import { OTHER_TITLE } from '@/core/occurrence/grouping';
import type { Category } from '@/data/api/categories';
import { Field, Txt } from '@/design/components';
import { IconPicker } from '@/features/common/IconPicker';
import type { IconName } from '@/design/icons';
import { FieldGroup } from '@/design/controls';
import { INKS, inkColor, inkSoft } from '@/design/inks';
import { useTheme } from '@/design/theme';
import { MIN_TARGET, radius, space } from '@/design/tokens';

/** A category being written but not yet created. */
export interface NewCategoryDraft {
  name: string;
  ink: string | null;
  icon: IconName | null;
}

export const EMPTY_CATEGORY_DRAFT: NewCategoryDraft = { name: '', ink: null, icon: null };

interface Props {
  categories: readonly Category[];
  categoryId: string | null;
  onChangeCategory: (categoryId: string | null) => void;
  /**
   * The half-written new category, or null when the fields are closed.
   *
   * Owned by the form rather than by this component, because the chore's save
   * is what creates it — a draft kept here would be unreachable from there.
   */
  draft: NewCategoryDraft | null;
  onChangeDraft: (draft: NewCategoryDraft | null) => void;
  /** Surfaced under the fields — a duplicate name is the common one. */
  createError?: string | null;
  /** Puts the form back at this section when the fields close. */
  onCollapse?: (() => void) | undefined;
}

export function CategoryPicker({
  categories,
  categoryId,
  onChangeCategory,
  draft,
  onChangeDraft,
  createError = null,
  onCollapse,
}: Props) {
  const { colors, isDark } = useTheme();
  const adding = draft !== null;

  const closeDraft = () => {
    onChangeDraft(null);
    onCollapse?.();
  };

  return (
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
            if (adding) closeDraft();
            else {
              // Choosing to write a new one is choosing not to use an
              // existing one; leaving a chip selected underneath would make
              // the save ambiguous.
              onChangeCategory(null);
              onChangeDraft(EMPTY_CATEGORY_DRAFT);
            }
          }}
          accessibilityLabel={adding ? 'Cancel new category' : 'Add a category'}
          tint={colors.text}
          wash={colors.sunken}
        />
      </View>

      {draft !== null ? (
        <View style={{ gap: space.sm, paddingTop: space.sm }}>
          {/* No confirm button below: this is saved with the chore. Saying so
                stops the fields reading as an unfinished step. */}
          <Field
            label="New category"
            hint="Saved when you save the chore."
            value={draft.name}
            onChangeText={(name) => onChangeDraft({ ...draft, name })}
            placeholder="Kitchen"
            maxLength={40}
            autoFocus
            {...(createError === null ? {} : { error: createError })}
          />

          {/* Labelled, unlike the loose swatch row it replaced. Eight coloured
              dots under a name field do not say what they colour. */}
          <FieldGroup label="Colour">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {INKS.map((option) => {
                const selected = draft.ink === option.name;
                return (
                  <Pressable
                    key={option.name}
                    onPress={() => onChangeDraft({ ...draft, ink: selected ? null : option.name })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Colour: ${option.label}`}
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

          {/* Named, because the chore's own icon picker sits directly below
              this block and two "Icon" headings in a column read as one
              control that has somehow been drawn twice. */}
          <IconPicker
            label="Category icon"
            value={draft.icon}
            onChange={(icon) => onChangeDraft({ ...draft, icon })}
            {...(onCollapse === undefined ? {} : { onCollapse })}
          />
        </View>
      ) : null}
    </FieldGroup>
  );
}

/**
 * How the chore sorts within whatever it is grouped by.
 *
 * Split out of the category picker so the icon picker can sit between the two —
 * see the note at the top of this file.
 */
export function PriorityPicker({
  priority,
  onChangePriority,
}: {
  priority: Priority;
  onChangePriority: (priority: Priority) => void;
}) {
  const { colors } = useTheme();
  return (
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
