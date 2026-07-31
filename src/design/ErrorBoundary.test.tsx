/**
 * The error boundary.
 *
 * Worth testing because the thing it prevents is invisible when it works and
 * catastrophic when it doesn't: on a release build a render-time throw leaves a
 * white screen with no message, no red box and no way back.
 *
 * React logs caught errors to the console, which would fill this suite's output
 * with stack traces for failures that are entirely expected, so it is silenced
 * per-test rather than globally — a genuinely unexpected error elsewhere should
 * still be loud.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ErrorBoundary } from './ErrorBoundary';

function Boom({ message = 'the projector exploded' }: { message?: string }): never {
  throw new Error(message);
}

/**
 * Throws while the flag is set, so a test can decide when recovery happens.
 *
 * The flag lives outside the component on purpose: React unmounts the subtree
 * when it catches, so anything the child remembers is gone by the time the
 * boundary resets. A `useState` counter here would throw forever and read as a
 * bug in the boundary rather than in the fixture.
 */
let flakyShouldThrow = true;
function FlakyChild() {
  if (flakyShouldThrow) throw new Error('first attempt failed');
  return <Text>recovered</Text>;
}

let consoleError: jest.SpyInstance;
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  flakyShouldThrow = true;
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('when something below throws', () => {
  it('shows a way forward instead of a blank screen', async () => {
    await render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('header', { name: 'That went wrong' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('says the data is safe, because that is the actual worry', async () => {
    await render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Nothing has been lost/)).toBeOnTheScreen();
  });

  it('shows the message verbatim, so a report can start with it', async () => {
    await render(
      <ErrorBoundary>
        <Boom message="occurrence key was undefined" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('occurrence key was undefined')).toBeOnTheScreen();
  });

  it('hands the error to a reporter, so a crash service has a seam later', async () => {
    const onError = jest.fn();
    await render(
      <ErrorBoundary onError={onError}>
        <Boom message="boom" />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.anything(),
    );
  });
});

describe('recovering', () => {
  it('re-renders the children when told to try again', async () => {
    // The test controls when the child stops throwing, rather than the child
    // counting its own attempts — React unmounts the subtree when it catches,
    // so anything the child remembers is gone by the time the button is
    // pressed.
    await render(
      <ErrorBoundary>
        <FlakyChild />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('header', { name: 'That went wrong' })).toBeOnTheScreen();

    flakyShouldThrow = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('recovered')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'That went wrong' })).toBeNull();
  });
});

describe('when nothing throws', () => {
  it('is invisible', async () => {
    await render(
      <ErrorBoundary>
        <Text>the app</Text>
      </ErrorBoundary>,
    );
    expect(screen.getByText('the app')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'That went wrong' })).toBeNull();
  });
});
