import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';

import { LandingPage } from './pages/LandingPage';

const AppShell = lazy(() => import('./components/AppShell').then((m) => ({ default: m.AppShell })));
const AddressPage = lazy(() => import('./pages/AddressPage').then((m) => ({ default: m.AddressPage })));
const TxPage = lazy(() => import('./pages/TxPage').then((m) => ({ default: m.TxPage })));
const BlockPage = lazy(() => import('./pages/BlockPage').then((m) => ({ default: m.BlockPage })));
const FeedPage = lazy(() => import('./pages/FeedPage').then((m) => ({ default: m.FeedPage })));
const WebOfTrustPage = lazy(() =>
  import('./pages/WebOfTrustPage').then((m) => ({ default: m.WebOfTrustPage })),
);

function LegacyAddressRedirect() {
  const { address } = useParams();
  return <Navigate to={`/app/address/${address ?? ''}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/app"
        element={
          <Suspense fallback={<p className="py-16 text-center text-sm text-zinc-500">Loading…</p>}>
            <AppShell />
          </Suspense>
        }
      >
        <Route index element={<FeedPage />} />
        <Route path="address/:address" element={<AddressPage />} />
        <Route path="tx/:txid" element={<TxPage />} />
        <Route path="block/:id" element={<BlockPage />} />
        <Route path="web-of-trust" element={<WebOfTrustPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      {/* pre-launch bookmarks keep working */}
      <Route path="/address/:address" element={<LegacyAddressRedirect />} />
      <Route path="/web-of-trust" element={<Navigate to="/app/web-of-trust" replace />} />
      <Route path="/leaderboard" element={<Navigate to="/app/web-of-trust" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
