import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/auth/session";
import { LoginForm } from "@/components/admin/LoginForm";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getStaffSession();
  if (session) redirect("/admin");
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <span className="font-[cursive] text-3xl text-[#7ed957]">Greenway</span>
          <h1 className="mt-1 text-lg font-semibold uppercase tracking-[0.2em] text-[#ffd700]">
            Back Office
          </h1>
          <p className="mt-2 text-sm text-white/50">
            Staff sign-in. Authorized employees only.
          </p>
        </div>
        <LoginForm initialError={error ?? null} />
        <p className="mt-6 text-center text-xs text-white/40">
          This is a private system. All activity is logged.
        </p>
      </div>
    </div>
  );
}
