const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const charLen = chars.length;

export function basicId() {
  let N = 6;
  let id = "";

  for (let i = 0; i < N; i += 1) {
    id += chars[(Math.random() * charLen - 1) << 0];
  }

  return id;
}