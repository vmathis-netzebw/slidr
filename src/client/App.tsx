import { useEffect, useState } from 'react';
import { SESSION_ID_PATTERN } from '../shared/protocol.js';
import { HomePage } from './pages/HomePage.js';
import { PresenterPage } from './pages/PresenterPage.js';
import { VotePage } from './pages/VotePage.js';

type Route =
  | { name: 'home' }
  | { name: 'presenter' }
  | { name: 'vote'; sessionId: string }
  | { name: 'not-found' };

function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  if (pathname === '/presenter' || pathname === '/presenter/') return { name: 'presenter' };

  const voteMatch = /^\/vote\/([^/]+)\/?$/.exec(pathname);
  if (voteMatch) {
    const sessionId = decodeURIComponent(voteMatch[1] ?? '').toUpperCase();
    if (SESSION_ID_PATTERN.test(sessionId)) return { name: 'vote', sessionId };
  }

  return { name: 'not-found' };
}

export function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'presenter':
      return <PresenterPage />;
    case 'vote':
      return <VotePage sessionId={route.sessionId} />;
    case 'not-found':
      return (
        <main className="voter voter--message">
          <h1>Seite nicht gefunden</h1>
          <p>Bitte den QR-Code erneut scannen.</p>
        </main>
      );
  }
}
