export function normalisePath(...parts: string[]): string {
  let p = parts.join("/").replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  if (p.length > 0 && !p.startsWith("/")) {
    p = "/" + p;
  }
  if (p === "") p = "/";
  return p;
}
