/**
 * /admin/account/set-password — where staff invite emails land (GW-017 fix).
 *
 * IMPORTANT: this page must NOT require a server-side session. Invite links
 * use Supabase's legacy token flow, which delivers the session tokens in the
 * URL FRAGMENT — invisible to the server. The client form reads the fragment,
 * establishes the session, and only then can the password be set. A
 * server-side redirect-to-login here would bounce every invitee before the
 * fragment could be processed. (The admin layout already renders bare
 * children when there is no server session, same as /admin/login.)
 *
 * The form itself is useless to attackers without a valid invite link or an
 * existing session: supabase.auth.updateUser() is authenticated by the
 * session, never by this page.
 */
import { SetPasswordForm } from "@/components/admin/SetPasswordForm";

export const dynamic = "force-dynamic";

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <span className="font-[cursive] text-3xl text-[#7ed957]">Greenway</span>
          <h1 className="mt-1 text-lg font-semibold uppercase tracking-[0.2em] text-[#ffd700]">
            Welcome to the team
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Set the password you&apos;ll use to sign in to the back office.
          </p>
        </div>
        <SetPasswordForm />
        <p className="mt-6 text-center text-xs text-white/40">
          This is a private system. All activity is logged.
        </p>
      </div>
    </div>
  );
}
