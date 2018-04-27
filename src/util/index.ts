/** Collapse list of binary parts into single buffer;*/
export function flatten(list: Array<ArrayLike<number>>): Uint8Array {

  let count = list.reduce((a, b) => {
    return a + (b.length);
  }, 0);

  let buffer = new Uint8Array(count);
  let offset = 0;

  list.forEach(x => {
    buffer.set(x, offset);
    offset += x.length;
  });

  return buffer;
}

export function isHex(s: string): boolean {
  return /^[0-9A-F]*$/i.test(s);
}

export function textToBytes(s: string): Uint8Array {
  const ua = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    ua[i] = s.charCodeAt(i);
  }
  return ua;
};
export function bytesToText(ua: Uint8Array | number[], start: number = 0, end: number = ua.length): string {
  let s = '';
  for (let i = start; i < end; i++) {
    s += String.fromCharCode(ua[i]);
  }
  return s;
};
export function hexToBytes(hex: string): Array<number> {
  let bytes: Array<number> = [];
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substr(c, 2), 16));
  }
  return bytes;
}
export function bytesToHex(bytes: Uint8Array | number[], start: number = 0, end: number = bytes.length): string {
  let hex: Array<string> = [];
  for (let i = start; i < end; i++) {
    hex.push((bytes[i] >>> 4).toString(16));
    hex.push((bytes[i] & 0xF).toString(16));
  }
  return hex.join("");
}

/* basic id*/
export function shortId(): [number, number, number, number, number, number, number, number] {
  var time = Date.now();

  return [
    Math.round(Math.random() * 255),
    Math.round(Math.random() * 255),
    Math.round(Math.random() * 255),
    Math.round(Math.random() * 255),
    (time >> 0) & 0xFF,
    (time >> 8) & 0xFF,
    Math.round((time / Math.random()) & 0xFF),
    Math.round((time / Math.random()) & 0xFF),
  ];
};