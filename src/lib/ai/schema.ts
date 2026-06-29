/**
 * src/lib/ai/schema.ts
 *
 * A tiny, zero-dependency schema + validator for AI structured outputs.
 *
 * Why not Zod? The whole point of structured outputs is (1) tell the model the
 * exact shape we want (as JSON Schema, which OpenAI-compatible providers can
 * CONSTRAIN to via response_format), and (2) VALIDATE the parsed result on our
 * side so a bad/weird response can never reach a draft. We need both a
 * JSON-Schema emitter and a runtime validator. This module gives us both with
 * no extra dependency, kept deliberately small and well-typed.
 *
 * Supported field kinds (enough for product enrichment): string (with min/max
 * length + optional), enum, string-array (with an allowed-value whitelist +
 * max items), number, boolean, and object. Validation COERCES gently (trims
 * strings, clamps arrays to allowed values) and returns typed errors so the
 * provider layer can retry once with the error appended.
 *
 * Server-or-shared safe (no node-only imports).
 */

export type FieldSpec =
  | { kind: "string"; description?: string; minLength?: number; maxLength?: number; optional?: boolean }
  | { kind: "enum"; description?: string; values: readonly string[]; optional?: boolean }
  | {
      kind: "stringArray";
      description?: string;
      /** If set, only these values are allowed; others are dropped during coercion. */
      allowed?: readonly string[];
      maxItems?: number;
      optional?: boolean;
    }
  | { kind: "number"; description?: string; min?: number; max?: number; optional?: boolean }
  | { kind: "boolean"; description?: string; optional?: boolean }
  | { kind: "object"; description?: string; fields: SchemaShape; optional?: boolean };

export type SchemaShape = Record<string, FieldSpec>;

export type AiSchema<T> = {
  name: string;
  shape: SchemaShape;
  /** Phantom type carrier (never used at runtime). */
  readonly __type?: T;
};

/** Define a schema with a name (used as the JSON-Schema title). */
export function defineSchema<T>(name: string, shape: SchemaShape): AiSchema<T> {
  return { name, shape };
}

// ---------------------------------------------------------------------------
// JSON Schema emitter (for response_format: { type: "json_schema", ... })
// ---------------------------------------------------------------------------

type JsonSchemaNode = Record<string, unknown>;

function fieldToJsonSchema(spec: FieldSpec): JsonSchemaNode {
  switch (spec.kind) {
    case "string": {
      const node: JsonSchemaNode = { type: "string" };
      if (spec.description) node.description = spec.description;
      if (typeof spec.minLength === "number") node.minLength = spec.minLength;
      if (typeof spec.maxLength === "number") node.maxLength = spec.maxLength;
      return node;
    }
    case "enum": {
      const node: JsonSchemaNode = { type: "string", enum: [...spec.values] };
      if (spec.description) node.description = spec.description;
      return node;
    }
    case "stringArray": {
      const items: JsonSchemaNode = spec.allowed
        ? { type: "string", enum: [...spec.allowed] }
        : { type: "string" };
      const node: JsonSchemaNode = { type: "array", items };
      if (spec.description) node.description = spec.description;
      if (typeof spec.maxItems === "number") node.maxItems = spec.maxItems;
      return node;
    }
    case "number": {
      const node: JsonSchemaNode = { type: "number" };
      if (spec.description) node.description = spec.description;
      if (typeof spec.min === "number") node.minimum = spec.min;
      if (typeof spec.max === "number") node.maximum = spec.max;
      return node;
    }
    case "boolean": {
      const node: JsonSchemaNode = { type: "boolean" };
      if (spec.description) node.description = spec.description;
      return node;
    }
    case "object": {
      return shapeToJsonSchema(spec.fields, spec.description);
    }
  }
}

function shapeToJsonSchema(shape: SchemaShape, description?: string): JsonSchemaNode {
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(shape)) {
    properties[key] = fieldToJsonSchema(spec);
    if (!("optional" in spec) || !spec.optional) required.push(key);
  }
  const node: JsonSchemaNode = {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
  if (description) node.description = description;
  return node;
}

/** Build the OpenAI `response_format` json_schema payload for a schema. */
export function toResponseFormat<T>(schema: AiSchema<T>): {
  type: "json_schema";
  json_schema: { name: string; schema: JsonSchemaNode; strict: true };
} {
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: shapeToJsonSchema(schema.shape),
      strict: true,
    },
  };
}

/** A compact, human/LLM-readable description of the shape (for prompt fallback). */
export function describeShape<T>(schema: AiSchema<T>): string {
  const lines: string[] = [];
  const walk = (shape: SchemaShape, indent: string) => {
    for (const [key, spec] of Object.entries(shape)) {
      const opt = "optional" in spec && spec.optional ? " (optional)" : "";
      let detail = spec.kind as string;
      if (spec.kind === "enum") detail = `one of [${spec.values.join(", ")}]`;
      else if (spec.kind === "stringArray")
        detail = spec.allowed
          ? `array of [${spec.allowed.join(", ")}]${spec.maxItems ? ` (max ${spec.maxItems})` : ""}`
          : "array of strings";
      else if (spec.kind === "string") {
        const bits = [
          spec.minLength ? `min ${spec.minLength}` : null,
          spec.maxLength ? `max ${spec.maxLength}` : null,
        ].filter(Boolean);
        detail = `string${bits.length ? ` (${bits.join(", ")} chars)` : ""}`;
      }
      lines.push(`${indent}- ${key}${opt}: ${detail}${spec.description ? ` — ${spec.description}` : ""}`);
      if (spec.kind === "object") walk(spec.fields, indent + "  ");
    }
  };
  walk(schema.shape, "");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Runtime validation + gentle coercion
// ---------------------------------------------------------------------------

export type ValidationError = { path: string; message: string };
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

function validateField(
  spec: FieldSpec,
  value: unknown,
  path: string,
  errors: ValidationError[],
): unknown {
  const missing = value === undefined || value === null;
  if (missing) {
    if ("optional" in spec && spec.optional) return undefined;
    errors.push({ path, message: "is required" });
    return undefined;
  }

  switch (spec.kind) {
    case "string": {
      if (typeof value !== "string") {
        errors.push({ path, message: "must be a string" });
        return undefined;
      }
      const trimmed = value.trim();
      if (typeof spec.minLength === "number" && trimmed.length < spec.minLength)
        errors.push({ path, message: `must be at least ${spec.minLength} characters` });
      if (typeof spec.maxLength === "number" && trimmed.length > spec.maxLength)
        errors.push({ path, message: `must be at most ${spec.maxLength} characters` });
      return trimmed;
    }
    case "enum": {
      if (typeof value !== "string" || !spec.values.includes(value)) {
        errors.push({ path, message: `must be one of: ${spec.values.join(", ")}` });
        return undefined;
      }
      return value;
    }
    case "stringArray": {
      const arr = Array.isArray(value) ? value : [value];
      let out = arr
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean);
      if (spec.allowed) {
        const set = new Set(spec.allowed);
        out = out.filter((v) => set.has(v)); // gently drop disallowed values
      }
      // de-dup, preserve order
      out = Array.from(new Set(out));
      if (typeof spec.maxItems === "number") out = out.slice(0, spec.maxItems);
      return out;
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) {
        errors.push({ path, message: "must be a number" });
        return undefined;
      }
      if (typeof spec.min === "number" && n < spec.min)
        errors.push({ path, message: `must be ≥ ${spec.min}` });
      if (typeof spec.max === "number" && n > spec.max)
        errors.push({ path, message: `must be ≤ ${spec.max}` });
      return n;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      errors.push({ path, message: "must be a boolean" });
      return undefined;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        errors.push({ path, message: "must be an object" });
        return undefined;
      }
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(spec.fields)) {
        out[key] = validateField(child, (value as Record<string, unknown>)[key], `${path}.${key}`, errors);
      }
      return out;
    }
  }
}

/** Validate (and gently coerce) a parsed value against a schema. */
export function validate<T>(schema: AiSchema<T>, value: unknown): ValidationResult<T> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: [{ path: schema.name, message: "expected a JSON object" }] };
  }
  const errors: ValidationError[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema.shape)) {
    out[key] = validateField(spec, (value as Record<string, unknown>)[key], key, errors);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out as T };
}

/** Format validation errors for re-prompting the model. */
export function formatErrors(errors: ValidationError[]): string {
  return errors.map((e) => `- ${e.path}: ${e.message}`).join("\n");
}
