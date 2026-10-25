/** Thrown by domain operations for invalid input; the message is safe to show to the user. */
export class DomainError extends Error { constructor(message: string) { super(message); this.name = 'DomainError'; } }
export type Result = { ok: true } | { ok: false; error: string };
