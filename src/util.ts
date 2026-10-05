let _counter = 0;

/** Generate a short, locally-unique id */
export function shortId(): string {
  // Read the global at call time so test environments can stub or remove it.
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(8));
    let id = "";
    for (let i = 0; i < bytes.length; i++) {
      id += bytes[i].toString(16).padStart(2, "0");
    }
    return id;
  }

  // Legacy fallback for environments without the Web Crypto API.
  return (++_counter).toString(36) + Math.random().toString(36).slice(2, 6);
}
