let _counter = 0;

/** Generate a short, locally-unique id */
export function shortId(): string {
  return (++_counter).toString(36) + Math.random().toString(36).slice(2, 6);
}
