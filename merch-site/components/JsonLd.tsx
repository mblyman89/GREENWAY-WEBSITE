import { jsonLdString } from "@/lib/seo-core";

/** R73 S4: server-rendered structured data (in the initial HTML, as Google recommends). */
export function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
