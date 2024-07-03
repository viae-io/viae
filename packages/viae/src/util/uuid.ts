const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const charLen = chars.length;

export function shortId(N = 7) {
  let id = "";

  for (let i = 0; i < N; i += 1) {
    id += chars[(Math.random() * charLen - 1) << 0];
  }

  return id;
}