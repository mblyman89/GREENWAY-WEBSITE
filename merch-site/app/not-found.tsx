import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--greenway)]">404</p>
      <h1 className="mt-2 text-4xl font-black text-white">That page isn&rsquo;t here.</h1>
      <Link href="/" className="mt-8 inline-flex rounded-full bg-[var(--orange)] px-6 py-3 text-xs font-black uppercase tracking-[0.16em] text-black">Shop all merch</Link>
    </main>
  );
}
