
import * as varint from 'varint';
import { shortId, textToBytes, bytes2Text, bytesToHex, hexToBytes } from './utils';
import { ViaMethod } from './method';
import { ViaStatus } from './status';

export interface ViaMessage {
  id: string;
  method?: ViaMethod;
  path?: string;   
  status?: ViaStatus;
  body?: any;
}

export namespace ViaMessage {
  export function serialiseBinary(msg: ViaMessage): Uint8Array {
    let list = [];

    list.push(msg.id ? hexToBytes(msg.id) : shortId());

    /* #1 method */
    if (msg.method) {
      list.push(varint.encode((msg.method << 3) | 1));
    }
    /* #2 status */
    if (msg.status) {
      list.push(varint.encode((msg.status << 3) | 2));
    }
    /* #3 path  */
    if (msg.path) {
      let bytes = textToBytes(msg.path);
      list.push(varint.encode((bytes.length << 3) | 3));
      list.push(bytes);
    }
    /* #7 - data type + body bytes */
    if (msg.body) {
      if (typeof (msg.body) == "string") {
        let trimmed = msg.body.trim();
        let type = (trimmed.charAt(0) == "{" && trimmed.charAt(trimmed.length - 1) == "}") ? DataType.Json : DataType.String;
        let bytes = textToBytes(msg.body);
        list.push(varint.encode((type << 3) | 7));
        list.push(bytes);
      }
      else if (msg.body instanceof Uint8Array) {
        let bytes = msg.body;
        list.push(varint.encode((DataType.Binary << 3) | 7));
        list.push(bytes);
      }
      else {
        let bytes = textToBytes(JSON.stringify(msg.body));
        list.push(varint.encode((DataType.Json << 3) | 7));
        list.push(bytes);
      }
    }

    //Collapse list into a buffer;
    let count = list.reduce(function (a, b) {
      return a + (b.length || 1);
    }, 0);

    let buffer = new Uint8Array(count);
    let offset = 0;

    list.forEach(x => {
      buffer.set(x, offset);
      offset += x.length || 1;
    });

    return buffer;
  }

  export function deserialiseBinary(binary: Uint8Array): ViaMessage {
    let off = 0;
    const id = bytesToHex(binary.slice(0, off += 8));
    const msg: ViaMessage = { id: id };

    while (off < binary.length) {
      let enc = varint.decode(binary, off); off += varint.decode.bytes;
      let len = 0;

      switch (enc & 0x7) {
        case 1: //method
          msg.method = enc >> 3;
          break;
        case 2: //status
          msg.status = enc >> 3;
          break;
        case 3: //path
          len = enc >> 3;
          msg.path = bytes2Text(binary.subarray(off, off += len));
          break;        
        case 7: //type + data        
          switch (enc >> 3) {
            case DataType.Json:
              msg.body = JSON.parse(bytes2Text(binary.subarray(off)));
              break;
            case DataType.String:
              msg.body = bytes2Text(binary.subarray(off));
              break;
            case DataType.Binary:
              msg.body = binary.slice(off);
              break;
          }
          off = binary.length;
          break;
      }
    }
    return msg;
  }
}

enum DataType {
  Json = 0,
  String = 1,
  Binary = 2
}