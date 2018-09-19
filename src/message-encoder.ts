import { textToBytes, flatten, bytesToText, bytesToHex, hexToBytes } from './util';
import * as varint from 'varint';
import { Message } from './message';

class BasicProtoWriter {
  private _parts = [];

  writeVarint(field: number, value: number) {
    this._parts.push([(field << 3) | 0]);
    this._parts.push(varint.encode(value));
  }
  writeBytes(field: number, value: Uint8Array) {
    this._parts.push([(field << 3) | 2]);
    this._parts.push(varint.encode(value.length));
    this._parts.push(value);
  }
  get buffer() {
    return flatten(this._parts);
  }
}

class BasicProtoReader {
  fields: { [field: number]: any };
  constructor(buffer: Uint8Array) {
    let offset = 0;
    this.fields = [];
    while (offset < buffer.length) {

      let byte = buffer[offset++];
      let type = byte & 0x7;
      let field = byte >> 3;
      switch (type) {
        case 0:
          this.fields[field] = varint.decode(buffer, offset); offset += varint.decode.bytes;
          break;
        case 2:
          let length = varint.decode(buffer, offset); offset += varint.decode.bytes;
          this.fields[field] = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length);
          offset += length;
          break;
        default:
          throw Error("unsupported protobuf-type");
      }
    }
  }
}

export class MessageSerialiser {
  encode(frame: Message): Uint8Array {
    let writer = new BasicProtoWriter();

    writer.writeBytes(1, textToBytes(frame.id));
    if (frame.head) writer.writeBytes(4, textToBytes(JSON.stringify(frame.head)));
    if (frame.data) writer.writeBytes(5, frame.data);

    return writer.buffer;
  }

  decode(buffer: Uint8Array): Message {
    let reader = new BasicProtoReader(buffer);
    let frame: Partial<Message> = {};

    for (let field in reader.fields) {
      switch (field) {
        case "1":
          frame.id = bytesToText(reader.fields[field]);
          break;
        case "4":
          frame.head = JSON.parse(bytesToText(reader.fields[field]));
          break;
        case "5":
          frame.data = reader.fields[field];
          break;
      }
    }
    return frame as Message;
  }
}