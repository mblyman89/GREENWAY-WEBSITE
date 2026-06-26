/**
 * Renders one or more JSON-LD structured-data blocks. Server-safe (no "use client").
 * Usage: <JsonLd data={storeSchema} /> or <JsonLd data={[a, b]} />
 */
type JsonLdProps = {
  data: Record<string, unknown> | Record<string, unknown>[];
  id?: string;
};

export function JsonLd({ data, id }: JsonLdProps) {
  const blocks = Array.isArray(data) ? data : [data];
  return (
    <>
      {blocks.map((block, index) => (
        <script
          key={id ? `${id}-${index}` : index}
          type="application/ld+json"
          // JSON.stringify output is safe; we control the input shape.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
    </>
  );
}
