const permits = new WeakSet<object>();

export type ExecutionPermit = { readonly _opaque: unique symbol };

/** Runtime-only permit issued only after an artifact verification gate passes. */
export function issueExecutionPermit(
  verified: boolean,
  reason: string,
): ExecutionPermit {
  if (!verified) {
    throw new Error(`Refusing to execute an unverified artifact: ${reason}`);
  }
  const token = {};
  permits.add(token);
  return token as ExecutionPermit;
}

export function requireExecutionPermit(permit: ExecutionPermit): void {
  if (!permits.has(permit as unknown as object)) {
    throw new Error(
      "Refusing execution without a runtime verification permit.",
    );
  }
}
