/**
 * Exhaustiveness guard for discriminated unions.
 *
 * Placing this in a switch's `default` makes TypeScript fail the build when a
 * new union member is added and some switch hasn't handled it — which is how
 * adding a recurrence rule stays a mechanical, compiler-guided change.
 */
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
