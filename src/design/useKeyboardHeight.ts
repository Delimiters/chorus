/**
 * How much of the screen the keyboard is currently covering.
 *
 * `KeyboardAvoidingView` moves a container out of the keyboard's way, which is
 * necessary but not sufficient: a child with a fixed `maxHeight` keeps that
 * height inside the smaller container and simply overflows it. Anything that
 * sizes a scrolling list against the screen needs the number itself.
 *
 * `WillChange` on iOS rather than `DidChange`, so the layout moves with the
 * keyboard animation instead of snapping once it has finished.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const shown = Keyboard.addListener(showEvent, (event) => {
      setHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}
