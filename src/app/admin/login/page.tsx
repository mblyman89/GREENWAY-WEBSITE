import { redirect } from "next/navigation";
import { authCheckUnavailable, getStaffSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/admin/LoginForm";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getStaffSession();
  if (session) redirect("/admin");
  const { error } = await searchParams;

  // SLICE L-27 — say WHOSE fault it is.
  //
  // Everyone who cannot be verified lands here, and until now they were all
  // shown the same blank sign-in box. That is right for someone who is signed
  // out, and actively misleading for someone whose session is perfectly valid
  // but whose auth check timed out: they type correct credentials, succeed,
  // and bounce straight back. The screen blames them for our outage.
  //
  // This does not weaken the gate. `getStaffSession()` already returned null
  // and the redirect above did not happen, so nobody is being let in — the
  // only thing that changes is that the sentence is true.
  const unavailable = authCheckUnavailable();
  const shownError = unavailable
    ? "We could not reach the sign-in service just now, so we could not check your session. This is a problem on our side, not with your password. Wait a moment and try again — and if you were in the middle of acknowledging a Leafly order, check the Online Orders board before pressing Accept a second time."
    : (error ?? null);

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <span className="font-[cursive] text-3xl text-[var(--admin-accent)]">Greenway</span>
          <h1 className="mt-1 text-lg font-semibold uppercase tracking-[0.2em] text-[var(--admin-gold)]">
            Back Office
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Staff sign-in. Authorized employees only.
          </p>
        </div>
        <LoginForm initialError={shownError} />
        <p className="mt-6 text-center text-xs text-white/40">
          This is a private system. All activity is logged.
        </p>
      </div>
    </div>
  );
}
