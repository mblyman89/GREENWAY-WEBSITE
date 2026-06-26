import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";

type SignupRecord = {
  id: string;
  submittedAt: string;
  firstName: string;
  lastName: string;
  birthday: string;
  mobilePhone: string;
  email: string;
  notificationStatus: string;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Loyalty Signup Review | Greenway Marijuana",
  description: "Internal review page for Greenway loyalty signup submissions.",
  robots: { index: false, follow: false },
};

async function readSignups(): Promise<SignupRecord[]> {
  try {
    const filePath = path.join(process.cwd(), "storage", "loyalty-signups.jsonl");
    const file = await readFile(filePath, "utf8");
    return file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SignupRecord)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  } catch {
    return [];
  }
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function LoyaltySignupReviewPage() {
  const signups = await readSignups();

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <Breadcrumbs items={[{ label: "Admin" }, { label: "Loyalty Signups" }]} />
      <section className="relative overflow-hidden bg-black text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(126,217,87,0.14),transparent_18rem),radial-gradient(circle_at_84%_16%,rgba(255,127,0,0.1),transparent_20rem)]" />
        <div className="noise-overlay" />
        <div className="relative mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-14">
          <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-[var(--greenway)] md:text-xs">Preview admin</p>
          <h1 className="mt-3 text-4xl font-black leading-none tracking-tight md:text-6xl">Loyalty Signup Review</h1>
          <p className="mt-4 max-w-3xl text-sm font-semibold leading-7 text-zinc-300 md:text-base md:leading-8">
            This internal preview page reads local submissions from <code className="rounded bg-white/10 px-1.5 py-0.5">storage/loyalty-signups.jsonl</code>. Use it to review new signups and manually add customers to the POS. Do not publish this page publicly without authentication.
          </p>

          <div className="mt-6 rounded-2xl border border-[var(--orange)]/30 bg-[var(--orange)]/10 p-4 text-xs leading-5 text-zinc-300 md:text-sm md:leading-6">
            Production requirement: this page must be protected by staff authentication or replaced by a secure CRM/POS/email workflow before launch. The current exposed preview URL is not a private admin system.
          </div>

          <div className="mt-8 overflow-hidden rounded-[1.4rem] border border-white/10 bg-zinc-950/88 shadow-2xl shadow-black/35">
            <div className="border-b border-white/10 px-4 py-4 md:px-6">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-[var(--gold)]">{signups.length} signup{signups.length === 1 ? "" : "s"}</p>
            </div>

            {signups.length === 0 ? (
              <p className="px-4 py-8 text-sm leading-6 text-zinc-400 md:px-6">No loyalty signups are currently stored in this preview environment.</p>
            ) : (
              <div className="divide-y divide-white/10">
                {signups.map((signup) => (
                  <article key={signup.id} className="grid gap-4 px-4 py-5 md:grid-cols-[1.1fr_1fr_1fr] md:px-6">
                    <div>
                      <p className="text-xl font-black text-white">{signup.firstName} {signup.lastName}</p>
                      <p className="mt-1 text-xs font-semibold text-zinc-400">Submitted {formatDate(signup.submittedAt)}</p>
                      <p className="mt-2 break-all text-xs text-zinc-500">ID: {signup.id}</p>
                    </div>
                    <div className="text-sm leading-6 text-zinc-300">
                      <p><span className="font-black text-white">Email:</span> {signup.email}</p>
                      <p><span className="font-black text-white">Phone:</span> {signup.mobilePhone}</p>
                      <p><span className="font-black text-white">Birthday:</span> {signup.birthday}</p>
                    </div>
                    <div className="text-sm leading-6 text-zinc-300">
                      <p><span className="font-black text-white">Notify:</span> {signup.notificationStatus}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
