export function AdminSetupNotice() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <span className="font-[cursive] text-3xl text-[#7ed957]">Greenway</span>
      <h1 className="mt-2 text-2xl font-bold text-[#ffd700]">
        Back Office — setup required
      </h1>
      <p className="mt-4 text-white/70">
        The Greenway back office is installed but not yet connected to Supabase.
        Add the following environment variables (see <code>.env.example</code>)
        and redeploy:
      </p>
      <ul className="mt-4 space-y-1 rounded-lg border border-white/10 bg-[#0a0a0a] p-4 font-mono text-sm text-white/80">
        <li>NEXT_PUBLIC_SUPABASE_URL</li>
        <li>NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
        <li>SUPABASE_SERVICE_ROLE_KEY</li>
        <li>ADMIN_BOOTSTRAP_EMAILS</li>
      </ul>
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-white/70">
        <li>Create a free project at supabase.com.</li>
        <li>
          Run the migration in <code>supabase/migrations/0001_slice1_foundation.sql</code>{" "}
          (SQL Editor → paste → run).
        </li>
        <li>Copy the URL + keys from Settings → API into your env vars.</li>
        <li>
          Set <code>ADMIN_BOOTSTRAP_EMAILS</code> to your email so your first
          login becomes the Owner.
        </li>
        <li>Redeploy, then visit <code>/admin/login</code>.</li>
      </ol>
    </div>
  );
}
