const SLASH_RUN = /\/+/g;

export function normalisePath(...parts: string[]): string {
  const joined = parts.join("/");
  let p = joined.includes("//") ? joined.replace(SLASH_RUN, "/") : joined;
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  if (p.length > 0 && !p.startsWith("/")) {
    p = "/" + p;
  }
  if (p === "") p = "/";
  return p;
}
