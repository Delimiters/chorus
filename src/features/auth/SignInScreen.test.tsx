/**
 * Component test for sign-in.
 *
 * Mocks at the hook boundary rather than mocking Supabase internals — the seam
 * the app actually depends on. RNTL v14 is async: `render` and `fireEvent` must
 * be awaited. See docs/TESTING.md.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/design/theme';
import { SignInScreen } from './SignInScreen';

const mockSignInMutate = jest.fn();
let mockSignInState = { isPending: false, isError: false, error: null as Error | null };

jest.mock('@/data/hooks/useAuth', () => ({
  useSignIn: () => ({ mutate: mockSignInMutate, ...mockSignInState }),
}));

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <SignInScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockSignInMutate.mockClear();
  mockSignInState = { isPending: false, isError: false, error: null };
});

describe('sign in', () => {
  it('shows the product name and tagline', async () => {
    await renderScreen();
    expect(screen.getByText('Chorus')).toBeOnTheScreen();
    expect(screen.getByText('Shared chores, shared reminders.')).toBeOnTheScreen();
  });

  it('disables submit until both fields have something in them', async () => {
    await renderScreen();
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Email'), 'jake@example.test');
    expect(button).toBeDisabled();

    await fireEvent.changeText(screen.getByLabelText('Password'), 'password123');
    expect(button).toBeEnabled();
  });

  it('submits the trimmed credentials', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'jake@example.test');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'password123');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockSignInMutate).toHaveBeenCalledWith({
      email: 'jake@example.test',
      password: 'password123',
    });
  });

  it('does not submit when the form is incomplete', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(mockSignInMutate).not.toHaveBeenCalled();
  });

  it('surfaces the error message', async () => {
    mockSignInState = {
      isPending: false,
      isError: true,
      error: new Error('That email and password combination is not right.'),
    };
    await renderScreen();
    expect(screen.getByText('That email and password combination is not right.')).toBeOnTheScreen();
  });

  it('marks the button busy while signing in', async () => {
    mockSignInState = { isPending: true, isError: false, error: null };
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });
});
