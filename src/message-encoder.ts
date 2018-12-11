import { textToBytes, flatten, bytesToText} from './util';
import * as varint from 'varint';
import { Frame } from './message';

export class MessageSerialiser {
  encode(frame: Frame): Uint8Array {
    let parts = [];
    let bytes;

    if (frame.id) {
      bytes = textToBytes(frame.id);

      parts.push([(1 << 3) | 2]);
      parts.push(varint.encode(bytes.length));
      parts.push(bytes);
    }
    if (frame.head) {
      bytes = textToBytes(JSON.stringify(frame.head));

      parts.push([(4 << 3) | 2]);
      parts.push(varint.encode(bytes.length));
      parts.push(bytes);
    }
    if (frame.raw) {
      bytes = frame.raw;
      parts.push([(5 << 3) | 2]);
      parts.push(varint.encode(bytes.length));
      parts.push(bytes);
    }
    return flatten(parts);
  }

  decode(buffer: Uint8Array): Frame {
    const frame: Partial<Frame> = {};
    const fields = this.decodeFields(buffer);

    for (let field in fields) {
      switch (field) {
        case "1":
          frame.id = bytesToText(fields[field]);
          break;
        case "4":
          frame.head = JSON.parse(bytesToText(fields[field]));
          break;
        case "5":
          frame.raw = fields[field];
          break;
      }
    }
    return frame as Frame;
  }

  private decodeFields(buffer: Uint8Array) {
    let offset = 0;
    let fields = {};
    while (offset < buffer.length) {
      let byte = buffer[offset++];
      let type = byte & 0x7;
      let field = byte >> 3;
      switch (type) {
        case 0:
          fields[field] = varint.decode(buffer, offset); offset += varint.decode.bytes;
          break;
        case 2:
          let length = varint.decode(buffer, offset); offset += varint.decode.bytes;
          fields[field] = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length);
          offset += length;
          break;
        default:
          throw Error("unsupported field");
      }
    }
    return fields;
  }
}