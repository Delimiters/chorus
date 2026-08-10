/**
 * The icons a chore or a category may carry.
 *
 * From `@expo/vector-icons`, which is already here — it is a direct dependency
 * of `expo` itself, so this costs no new package. MaterialCommunityIcons is
 * Apache 2.0 for both the glyphs and the webfont, which requires no
 * attribution, and it renders as *text* through a font rather than through a
 * native module. Adding icons is therefore a pure JavaScript change: no
 * prebuild, no rebuild, no EAS build, and no further erosion of what can run
 * where.
 *
 * **Import the set by subpath, never from the barrel.** `@expo/vector-icons`
 * resolves its `main` to a file that eagerly requires all nineteen fonts, so
 * `import { MaterialCommunityIcons } from '@expo/vector-icons'` costs about
 * 4 MB where the subpath costs 1.3 MB. Both work and neither warns.
 *
 * This list is deliberately short. The set has 7,448 glyphs; a picker with
 * 7,448 options is a search problem, and a household has maybe a dozen kinds
 * of chore. These are the ones worth offering, grouped the way somebody
 * looking for "the bin one" would look.
 *
 * The names are checked against the library's own TypeScript union at compile
 * time, so a typo here is a build error rather than a blank square on a phone.
 */

import type { ComponentProps } from 'react';
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface IconGroup {
  readonly title: string;
  readonly icons: readonly IconName[];
}

/**
 * Outline variants preferred throughout.
 *
 * Mixing filled and outline in one grid reads as accidental, and outline holds
 * up better at small sizes against this app's muted palette.
 */
export const ICON_GROUPS: readonly IconGroup[] = [
  {
    title: 'Kitchen',
    icons: [
      'silverware-fork-knife',
      'dishwasher',
      'fridge-outline',
      'stove',
      'microwave',
      'kettle',
      'coffee-maker',
      'pot-steam',
      'countertop-outline',
      'food-apple',
    ],
  },
  {
    title: 'Laundry',
    icons: [
      'washing-machine',
      'tumble-dryer',
      'iron',
      'iron-board',
      'hanger',
      'tshirt-crew',
      'basket-outline',
      'wardrobe-outline',
    ],
  },
  {
    title: 'Bins',
    icons: [
      'trash-can-outline',
      'recycle',
      'compost',
      'bottle-soda-classic-outline',
      'newspaper-variant-outline',
    ],
  },
  {
    title: 'Cleaning',
    icons: [
      'broom',
      'vacuum',
      'spray-bottle',
      'bucket-outline',
      'hand-wash-outline',
      'window-shutter',
      'mirror',
      'shower',
      'toilet',
      'paper-roll-outline',
      'bathtub-outline',
      'bed-outline',
      'sofa-outline',
    ],
  },
  {
    title: 'Outdoors',
    icons: [
      'flower-outline',
      'watering-can-outline',
      'sprout-outline',
      'grass',
      'tree-outline',
      'shovel',
      'mower',
      'fence',
    ],
  },
  {
    title: 'Pets',
    icons: ['dog', 'cat', 'paw', 'fish', 'bowl-outline'],
  },
  {
    title: 'Maintenance',
    icons: [
      'hammer-wrench',
      'screwdriver',
      'lightbulb-outline',
      'air-filter',
      'fire-extinguisher',
      'smoke-detector-outline',
      'snowflake',
    ],
  },
  {
    title: 'Out and about',
    icons: ['car', 'car-wash', 'bike', 'cart-outline', 'package-variant-closed'],
  },
  {
    title: 'Admin',
    icons: [
      'cash-multiple',
      'receipt-text-outline',
      'email-outline',
      'calendar-check-outline',
      'clipboard-check-outline',
      'pill',
      'home-outline',
      'key-outline',
    ],
  },
];

/** Flat, for validation. */
export const ICON_NAMES: readonly IconName[] = ICON_GROUPS.flatMap((g) => g.icons);

const ALLOWED = new Set<string>(ICON_NAMES);

/**
 * Narrows a value read from the database.
 *
 * The column is plain text on purpose — a CHECK listing every name would
 * couple the schema to a design decision and need a migration to add one
 * icon. Validation lives here instead, and an unrecognised name degrades to
 * no icon rather than crashing a list.
 */
export function toIconName(value: unknown): IconName | null {
  return typeof value === 'string' && ALLOWED.has(value) ? (value as IconName) : null;
}
