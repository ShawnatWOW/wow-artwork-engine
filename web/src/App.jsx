import { useEffect, useState } from 'react';

// Milestone 0 shell. The weekly grid, pick/pass tray, EON preview, and
// history views (M2) mount here. For now it confirms the backend is reachable
// and shows true-to-sign preview frames using the Tailwind aspect ratios.
export default function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));
  }, []);

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">WOW Artwork Engine</h1>
        <p className="text-sm text-neutral-400">
          Backend:{' '}
          <span className={health?.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'}>
            {health?.status ?? 'checking…'}
          </span>
        </p>
      </header>

      <section className="space-y-6">
        <Frame label="Spectacular · 1692×468" className="aspect-spectacular" />
        <div className="flex gap-3">
          <Frame label="EON face · 256×384" className="aspect-eon-face w-32" />
          <Frame label="EON face · 256×384" className="aspect-eon-face w-32" />
          <Frame label="EON face · 256×384" className="aspect-eon-face w-32" />
        </div>
      </section>
    </main>
  );
}

function Frame({ label, className }) {
  return (
    <div>
      <div className={`grid place-items-center rounded border border-neutral-700 bg-neutral-900 ${className}`}>
        <span className="text-xs text-neutral-500">{label}</span>
      </div>
    </div>
  );
}
