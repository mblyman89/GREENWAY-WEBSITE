import Link from "next/link";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo/seo";
import { unsubscribeByToken } from "@/lib/loyalty/signups-store";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Unsubscribe",
  description: "Manage your Greenway Marijuana email preferences.",
  path: "/unsubscribe",
  noindex: true, // keep this page out of search results
});

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let heading = "Manage your emails";
  let message = "";
  let tone: "ok" | "error" = "ok";

  if (!token) {
    tone = "error";
    heading = "Link looks incomplete";
    message =
      "This unsubscribe link is missing its code. Please use the “Unsubscribe” link at the bottom of one of our emails, or contact us and we'll take care of it.";
  } else {
    const res = await unsubscribeByToken(token);
    if (!res.ok) {
      if (res.reason === "not-configured") {
        tone = "error";
        heading = "We couldn't process that right now";
        message = "Something's temporarily unavailable. Please try again shortly, or contact us and we'll remove you.";
      } else {
        tone = "error";
        heading = "We couldn't find that subscription";
        message =
          "This link may have already been used or is no longer valid. If you're still getting emails, contact us and we'll remove you right away.";
      }
    } else {
      const name = res.firstName ? `, ${res.firstName}` : "";
      heading = res.alreadyOff ? "You're already unsubscribed" : "You've been unsubscribed";
      message = res.alreadyOff
        ? `You're not on our marketing email list${name}. You won't receive newsletters from us.`
        : `Done${name} — you won't receive any more marketing emails from us. We're sorry to see you go!`;
    }
  }

  return (
    <main id="top" className="min-h-screen bg-black text-white">
      <Header />
      <section className="relative overflow-hidden bg-black text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(255,127,0,0.13),transparent_18rem),radial-gradient(circle_at_88%_18%,rgba(255,215,0,0.09),transparent_22rem),radial-gradient(circle_at_52%_88%,rgba(126,217,87,0.07),transparent_24rem)]" />
        <div className="noise-overlay" />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center md:px-8 md:py-28">
          <span
            className={`mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full text-3xl ${
              tone === "ok" ? "bg-[var(--greenway)]/15 text-[var(--greenway)]" : "bg-[var(--orange)]/15 text-[var(--orange)]"
            }`}
          >
            {tone === "ok" ? "✓" : "!"}
          </span>
          <h1 className="text-3xl font-black uppercase tracking-tight text-white md:text-5xl">{heading}</h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-white/70 md:text-lg">{message}</p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-full bg-[var(--greenway)] px-6 py-3 text-sm font-semibold text-black transition hover:brightness-110"
            >
              Back to greenwaymarijuana.com
            </Link>
            <Link
              href="/loyalty"
              className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white/80 transition hover:border-white/40"
            >
              Loyalty program
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
