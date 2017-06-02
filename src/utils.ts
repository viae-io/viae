
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

export function textToBytes(s: string): Uint8Array {
  var ua = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) {
    ua[i] = s.charCodeAt(i);
  }
  return ua;
};

export function bytes2Text(ua: Uint8Array): string {
  var s = '';
  for (var i = 0; i < ua.length; i++) {
    s += String.fromCharCode(ua[i]);
  }
  return s;
};

// from crypto-js

export function hexToBytes(hex) {
  for (var bytes = [], c = 0; c < hex.length; c += 2)
    bytes.push(parseInt(hex.substr(c, 2), 16));
  return bytes;
}

export function bytesToHex(bytes) {
  for (var hex = [], i = 0; i < bytes.length; i++) {
    hex.push((bytes[i] >>> 4).toString(16));
    hex.push((bytes[i] & 0xF).toString(16));
  }
  return hex.join("");
}

export function concatBuffers(...buffers: ArrayBuffer[]): ArrayBuffer {

  if (buffers.length == 0)
    return new ArrayBuffer(0);

  let current = buffers[0];

  for (let i = 1; i < buffers.length; i++) {
    current = concatBuffer(current, buffers[i]);
  }

  return current;
};

var concatBuffer = function (buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer {

  var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
};