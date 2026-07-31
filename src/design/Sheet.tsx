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
 */

import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Txt } from './components';
import { useTheme } from './theme';
import { radius, space } from './tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** A quiet line under the title — what this sheet is about. */
  subtitle?: string | undefined;
  children: React.ReactNode;
}

export function Sheet({ visible, onClose, title, subtitle, children }: Props) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim }}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={{ flex: 1 }}
        />

        <SafeAreaView edges={['bottom']} style={{ backgroundColor: colors.surface }}>
          <View
            style={{
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              backgroundColor: colors.surface,
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              paddingBottom: space.lg,
              gap: space.md,
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

            <View style={{ gap: 2 }}>
              <Txt variant="bodyStrong" accessibilityRole="header">
                {title}
              </Txt>
              {subtitle === undefined ? null : (
                <Txt variant="small" tone="faint">
                  {subtitle}
                </Txt>
              )}
            </View>

            {children}
          </View>
        </SafeAreaView>
      </View>
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
