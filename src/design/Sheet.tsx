/**
 * A bottom sheet.
 *
 * React Native's own `Modal` with a slide animation, rather than
 * `@gorhom/bottom-sheet`. The sheets in this app are short, static lists of
 * actions — no snap points, no gesture-driven resizing, nothing the library
 * exists to provide. Its dependency on Reanimated and gesture-handler would also
 * be two more native modules between the app and Expo Go, which is the only
 * place it can run on the dev machine.
 *
 * The backdrop is a real button, not a bare `Pressable` with no label: dismissal
 * has to be reachable without sight of the screen, and a modal you can only
 * leave by aiming at empty space is a trap.
 *
 * ── Why the height is capped ──────────────────────────────────────────────
 *
 * That backdrop is a `flex: 1` sibling above a bottom-anchored sheet, so a tall
 * sheet squeezes it to **nothing** — and the way out goes with it. Jake, on a
 * chore with a lot of subtasks: *"it took up the whole screen and was too big
 * for it and I couldn't back out of it without either closing the app or
 * picking one of the options that actually showed up on the screen."* The
 * actions had been pushed off the bottom and the backdrop off the top.
 *
 * So the sheet is capped, its body scrolls, and anything the caller passes as
 * `footer` stays pinned below the scroll. The cap is what guarantees there is
 * always backdrop left to tap, which makes it a correctness rule rather than a
 * matter of taste — do not remove it to let one more row fit.
 *
 * The cap is measured against the screen **minus the keyboard**, which is not
 * the same as the screen. `useKeyboardHeight`'s own docblock says why, and it
 * says it about this exact mistake: *"a child with a fixed `maxHeight` keeps
 * that height inside the smaller container and simply overflows it."* The first
 * version capped against the full window, so with the keyboard up the picker
 * sheet came back to within a few points of filling its container and the
 * backdrop went with it — the original bug, one text size from returning.
 */

import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Txt } from './components';
import { useTheme } from './theme';
import { useKeyboardHeight } from './useKeyboardHeight';
import { radius, space } from './tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** A quiet line under the title — what this sheet is about. */
  subtitle?: string | undefined;
  children: React.ReactNode;
  /**
   * Rows that stay put while the body scrolls.
   *
   * For the actions, when a sheet has enough content to need scrolling at all.
   * Jake's suggestion, and the right one: *"maybe the buttons sit at the bottom
   * statically and you can scroll the preview area with the subtasks."* What
   * you came to the sheet to **do** should not be the thing that scrolls away.
   */
  footer?: React.ReactNode;
}

/**
 * How much of the screen a sheet may take.
 *
 * The remainder is backdrop, and the backdrop is the way out — so this is the
 * number that decides whether the sheet can be dismissed at all. On an iPhone
 * 16 Pro that leaves about 118pt, roughly half of which is clear of the status
 * bar — well past the project's 44pt floor rather than a sliver to aim at.
 */
const MAX_SHEET_FRACTION = 0.86;

/**
 * How much of the sheet the pinned footer may take.
 *
 * The rest belongs to the body. Without this the actions grew to whatever they
 * wanted and the preview — the reason the sheet was opened — got whatever was
 * left, which on a chore with eighteen steps was five rows.
 */
const MAX_FOOTER_FRACTION = 0.55;

export function Sheet({ visible, onClose, title, subtitle, children, footer }: Props) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const keyboard = useKeyboardHeight();

  // What the sheet is actually laid out in: the screen less whatever the
  // keyboard is covering, because `KeyboardAvoidingView` shrinks the container
  // and a `maxHeight` measured against the whole window would not notice.
  const available = height - keyboard;
  const sheetCap = available * MAX_SHEET_FRACTION;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/*
        Lifted clear of the keyboard.
      
        A sheet with a field in it — the "add to today" picker — put its options
        behind the keyboard with no way to reach them: the list is anchored to
        the bottom of the screen, the keyboard covers the bottom of the screen,
        and the sheet had no idea the keyboard existed. `padding` rather than
        `height`, because the sheet is bottom-anchored inside a `Modal` and
        animating its height fights the slide-in.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1 }}
        />

        <SafeAreaView
          edges={['bottom']}
          style={{
            backgroundColor: colors.surface,
            maxHeight: sheetCap,
            // Not RN's default of 0: without this the sheet keeps its content's
            // height inside a container that has become smaller than the cap —
            // the keyboard case — and the backdrop absorbs the whole loss.
            flexShrink: 1,
          }}
        >
          <View
            style={{
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              backgroundColor: colors.surface,
              paddingTop: space.md,
              gap: space.md,
              // `flexShrink`, so the cap above actually bites: without it this
              // view keeps its content's full height and overflows the parent
              // rather than letting the scroll view inside do its job.
              flexShrink: 1,
            }}
          >
            {/* The grabber is decoration; it is not the way out, so it is hidden
                from assistive tech rather than announced as an unlabelled view. */}
            <View
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={{
                alignSelf: 'center',
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.rule,
              }}
            />

            <View style={{ gap: 2, paddingHorizontal: space.lg }}>
              <Txt variant="bodyStrong" accessibilityRole="header">
                {title}
              </Txt>
              {subtitle === undefined ? null : (
                <Txt variant="small" tone="faint">
                  {subtitle}
                </Txt>
              )}
            </View>

            {/*
              The body scrolls; the title above and the footer below do not.

              `flexShrink` again rather than `flex: 1`: a short sheet should be
              as tall as its content, not stretched to the cap, so the scroll
              view only takes over once there is more than fits.
            */}
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{
                paddingHorizontal: space.lg,
                paddingBottom: footer === undefined ? space.lg : space.md,
                gap: space.md,
              }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>

            {footer === undefined ? null : (
              /*
                Pinned, but not unbounded.
              
                The occurrence sheet has seven actions, each with a hint, and
                letting them take whatever they wanted left five subtask rows
                visible above them — the preview Jake opened the sheet to read,
                squeezed to nothing by the thing meant to stay put for him. So
                the footer gets at most this much and scrolls within it, which
                means the common case (a few actions, no scrolling anywhere) is
                unchanged and the pathological one degrades into two halves
                rather than one half and a sliver.
              */
              <View
                style={{
                  maxHeight: sheetCap * MAX_FOOTER_FRACTION,
                  borderTopWidth: 1,
                  borderTopColor: colors.rule,
                  /*
                   * Deliberately **not** `flexShrink: 1`.
                   *
                   * With both the body and the footer able to shrink, flexbox
                   * takes from each in proportion — so the footer scrolled too,
                   * and its last row sat clipped against the bottom of the
                   * screen looking broken. The body is what should give way:
                   * it is the part you scroll, and the actions are the part
                   * that must stay whole.
                   *
                   * The cap above is what stops a long action list eating the
                   * sheet, which is the job `flexShrink` was reached for.
                   */
                }}
              >
                <ScrollView
                  contentContainerStyle={{
                    paddingHorizontal: space.lg,
                    /*
                     * Clear of the home indicator, which draws over the app
                     * whatever the sheet thinks its bounds are. The
                     * `SafeAreaView` inset is not reliable here — inside a
                     * `Modal` the provider's measurements do not always reach
                     * the subtree — and the last row of the footer landing
                     * under the bar reads as a clipped sheet rather than as a
                     * scroll that has more below it.
                     */
                    paddingBottom: space.xxl,
                    paddingTop: space.sm,
                    gap: 2,
                  }}
                  keyboardShouldPersistTaps="handled"
                >
                  {footer}
                </ScrollView>
              </View>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** One action in a sheet. Destructive ones read in the danger tone. */
export function SheetAction({
  label,
  hint,
  onPress,
  tone = 'normal',
  disabled = false,
}: {
  label: string;
  hint?: string | undefined;
  onPress: () => void;
  tone?: 'normal' | 'danger';
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint === undefined ? label : `${label}. ${hint}`}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        minHeight: 52,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.sunken : 'transparent',
        opacity: disabled ? 0.4 : 1,
        gap: 1,
      })}
    >
      <Txt variant="body" style={tone === 'danger' ? { color: colors.danger } : undefined}>
        {label}
      </Txt>
      {hint === undefined ? null : (
        <Txt variant="small" tone="faint">
          {hint}
        </Txt>
      )}
    </Pressable>
  );
}
