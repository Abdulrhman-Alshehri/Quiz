// Shown when the build has no Supabase settings, instead of a broken page.
export default function Setup() {
  return (
    <main className="page page--narrow">
      <h1 className="h1">This quiz is not connected to its database yet</h1>
      <p className="lead">
        The page loaded, but the build does not know which Supabase project to use, so nobody can join yet.
      </p>
      <ol className="steps">
        <li>
          Open <code>.env.production</code> in the repository and set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (Supabase dashboard, Project Settings, API Keys).
        </li>
        <li>Commit the change. The GitHub Pages workflow rebuilds and publishes the site.</li>
        <li>Reload this page.</li>
      </ol>
      <p className="muted">Use the publishable key only. Never put a secret or service-role key in the website.</p>
    </main>
  );
}
