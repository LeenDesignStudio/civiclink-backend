/** Transaction handle passed from `withTx` into stores. Fakes may ignore it. */
export type Tx = unknown;

export type RunTx = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export const directTx: RunTx = (fn) => fn(undefined);
