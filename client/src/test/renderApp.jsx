import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.jsx';
import { AppProviders } from '../AppProviders.jsx';
import { createFakeApi } from './fakeApi.js';

/** Renders the whole app against a fake API. Pass `token` to start with a saved session. */
export function renderApp({ routes = {}, token } = {}) {
  if (token) localStorage.setItem('shrt.token', token);
  const api = createFakeApi(routes);
  const user = userEvent.setup();
  const utils = render(
    <AppProviders fetchFn={api.fetchFn}>
      <App />
    </AppProviders>,
  );
  return { user, api, ...utils };
}
