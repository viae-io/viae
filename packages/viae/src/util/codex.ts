import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { pack as msgpackEncode, unpack as msgpackDecode } from 'msgpackr';

export interface Codex {
  [encoding: string]: Encoder
}

export interface Encoder {
  encode(value: any): Uint8Array,
  decode(value: Uint8Array): any
}

export namespace Codex {
  export function createDefault(): Codex {
    return {
      "msgpack": {
        encode: msgpackEncode,
        decode: msgpackDecode
      },
      "cbor": {
        encode: cborEncode,
        decode: cborDecode
      },
      "json": {
        encode: function (x) { return textToBytes(JSON.stringify(x)) },
        decode: function (x) { return JSON.parse(bytesToText(x)) }
      },
      "none": {
        encode(value) { return value },
        decode(value) { return value }
      }
    }
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function textToBytes(s: string): Uint8Array {
  return encoder.encode(s);
};

export function bytesToText(ua: Uint8Array): string {
  return decoder.decode(ua);
};