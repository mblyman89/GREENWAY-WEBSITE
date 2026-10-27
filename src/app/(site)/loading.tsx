export default function Loading() {
  return (
    <main className="min-h-screen bg-black px-4 py-10 text-white md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-11 w-11 animate-pulse rounded-full bg-[var(--greenway)]" />
          <div>
            <div className="h-3 w-44 animate-pulse rounded-full bg-white/20" />
            <div className="mt-2 h-3 w-28 animate-pulse rounded-full bg-white/10" />
          </div>
        </div>

        <section className="film-strip overflow-hidden rounded-[2rem] border border-white/10 bg-[var(--charcoal)] p-6 shadow-2xl shadow-black/40 md:p-10">
          <div className="max-w-3xl">
            <div className="h-3 w-48 animate-pulse rounded-full bg-[var(--greenway)]/40" />
            <div className="mt-6 h-14 w-full max-w-2xl animate-pulse rounded-2xl bg-white/15 md:h-20" />
            <div className="mt-4 h-14 w-4/5 animate-pulse rounded-2xl bg-white/10 md:h-20" />
            <div className="mt-7 grid gap-3 md:grid-cols-2">
              <div className="h-12 animate-pulse rounded-full bg-[var(--orange)]/35" />
              <div className="h-12 animate-pulse rounded-full bg-white/10" />
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          {["menu", "specials", "location"].map((item) => (
            <div key={item} className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5">
              <div className="h-40 animate-pulse rounded-[1.5rem] bg-white/10" />
              <div className="mt-5 h-3 w-24 animate-pulse rounded-full bg-white/20" />
              <div className="mt-3 h-6 w-4/5 animate-pulse rounded-full bg-white/15" />
              <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-white/10" />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
