import { Suspense, lazy, useEffect } from 'react';
import { config } from './lib/config';
import { useRoute } from './lib/router';
import Landing from './pages/Landing';
import Join from './pages/Join';
import Play from './pages/Play';
import Setup from './pages/Setup';
import { Spinner } from './components/ui';

// Presenter and big-screen pages load on demand, so phones download less.
const Screen = lazy(() => import('./pages/Screen'));
const AdminHome = lazy(() => import('./pages/AdminHome'));
const AdminSession = lazy(() => import('./pages/AdminSession'));

export default function App() {
  const { path, query } = useRoute();
  const parts = path.split('/').filter(Boolean);
  const section = parts[0] || '';

  useEffect(() => {
    document.body.dataset.section = section || 'home';
  }, [section]);

  if (!config.isConfigured) return <Setup />;

  let page;
  switch (section) {
    case '':
      page = <Landing />;
      break;
    case 'join':
      page = <Join query={query} />;
      break;
    case 'play':
      page = <Play query={query} />;
      break;
    case 'screen':
      page = <Screen code={decodeURIComponent(parts[1] || '')} />;
      break;
    case 'admin':
      page = parts[1] === 'session' && parts[2] ? <AdminSession sessionId={parts[2]} /> : <AdminHome />;
      break;
    default:
      page = <Landing notFound />;
  }
  return (
    <Suspense
      fallback={
        <main className="page page--narrow">
          <Spinner label="جارٍ التحميل…" />
        </main>
      }
    >
      {page}
    </Suspense>
  );
}
