/**
 * Sign up.
 *
 * The assertion this file exists for is the one that looks like nothing: with
 * email confirmation enabled, signup returns **200 with a user and no
 * session**. Nothing navigates, because there is nothing to navigate with. The
 * first version ignored the response, so tapping "Create account" against a
 * project with confirmation on created the account, showed no message, and left
 * you on the form — and trying again then reported the address as already
 * registered.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/design/theme';
import { SignUpScreen } from './SignUpScreen';

const mockMutate = jest.fn();
let mockState: {
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  data?: { needsConfirmation: boolean };
} = { isPending: false, isError: false, error: null };

jest.mock('@/data/hooks/useAuth', () => ({
  useSignUp: () => ({ mutate: mockMutate, ...mockState }),
}));

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

async function renderScreen() {
  return render(
    <ThemeProvider>
      <SignUpScreen />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockMutate.mockClear();
  mockState = { isPending: false, isError: false, error: null };
});

describe('creating an account', () => {
  it('submits the details', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Your name'), 'Jake');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'jake@example.test');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'password123');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));

    expect(mockMutate).toHaveBeenCalledWith({
      email: 'jake@example.test',
      password: 'password123',
      displayName: 'Jake',
    });
  });

  it('surfaces a failure', async () => {
    mockState = {
      isPending: false,
      isError: true,
      error: new Error('There is already an account with that email. Try signing in.'),
    };
    await renderScreen();
    expect(screen.getByText(/already an account with that email/)).toBeOnTheScreen();
  });
});

describe('when the address has to be confirmed', () => {
  it('says so, naming the address, instead of appearing to do nothing', async () => {
    mockState = {
      isPending: false,
      isError: false,
      error: null,
      data: { needsConfirmation: true },
    };
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'jake@example.test');

    expect(screen.getByText(/Account created/)).toBeOnTheScreen();
    expect(screen.getByText(/jake@example.test/)).toBeOnTheScreen();
    expect(screen.getByText(/come back and sign in/)).toBeOnTheScreen();
  });

  it('says nothing when a session came back, because the app is about to navigate', async () => {
    mockState = {
      isPending: false,
      isError: false,
      error: null,
      data: { needsConfirmation: false },
    };
    await renderScreen();
    expect(screen.queryByText(/Account created/)).toBeNull();
  });

  it('says nothing before anything has been submitted', async () => {
    await renderScreen();
    expect(screen.queryByText(/Account created/)).toBeNull();
  });
});
