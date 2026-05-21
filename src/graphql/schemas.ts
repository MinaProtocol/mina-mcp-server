import { z } from "zod";

// Boundary validation for the hand-rolled daemon/archive GraphQL queries
// (issue #23). Every closed shape bug so far (#3 coinbaseReceiver rename,
// #4 missing stateHash, #5 missing token, #12 null handling) was a response
// that didn't match what the code assumed — and surfaced only at runtime when
// a user hit it.
//
// SDK-backed paths (@o1-labs/mina-sdk etc.) are already typed; this covers the
// queries the providers still issue directly via `graphql.query(QUERIES.*)`.
//
// Schemas are intentionally lenient on inner fields (.passthrough()) — they
// assert the envelope, the identifying field, and its type, which is what
// catches a top-level rename / wrong type / null-vs-missing drift without
// coupling every selection-set tweak to a schema edit. Deeper field coverage
// lives in test/unit/schemas.test.ts against representative fixtures.

const blockNode = z.object({ stateHash: z.string() }).passthrough();

export const BlockResponse = z
  .object({ block: blockNode.nullable() })
  .passthrough();

export const BestChainResponse = z
  .object({ bestChain: z.array(blockNode).nullable() })
  .passthrough();

// The account query is read on several paths (balance, nonce, delegate), so
// assert the envelope is an object-or-null rather than forcing one inner field.
export const AccountResponse = z
  .object({ account: z.record(z.unknown()).nullable() })
  .passthrough();

export const GenesisConstantsResponse = z
  .object({ genesisConstants: z.object({}).passthrough() })
  .passthrough();

/**
 * Parse `data` against `schema`, throwing a clear, **redaction-safe** error on
 * mismatch (the message carries Zod issue paths + messages, never the response
 * values). Returns the typed data on success.
 */
export function validateData<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(
      `unexpected ${label} response shape (daemon/archive schema drift?): ${issues}`
    );
  }
  return result.data;
}
