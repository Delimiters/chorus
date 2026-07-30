import { render, screen } from '@testing-library/react-native';

import Index from './index';

// Also the smoke test for the `app` jest project itself: it proves the
// jest-expo preset, the RNTL renderer, and the module aliases all work.
//
// Note: RNTL v14 adopted React 19's async rendering model, so `render`,
// `fireEvent`, and `renderHook` all return promises and MUST be awaited.
// Forgetting the await fails with the opaque "render function has not been
// called". See docs/TESTING.md.
describe('Index screen', () => {
  it('renders the app name', async () => {
    await render(<Index />);
    expect(screen.getByText('Chorus')).toBeOnTheScreen();
  });

  it('renders the phase subtitle', async () => {
    await render(<Index />);
    expect(screen.getByText(/Phase 0/)).toBeOnTheScreen();
  });
});
