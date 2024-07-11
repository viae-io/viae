
export function toUint8Array(value: ArrayBuffer | ArrayBufferView) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value, 0);

}

export * from './normalise';
export * from './uuid';
export * from './codex';