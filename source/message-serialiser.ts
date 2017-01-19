
import * as varint from 'varint';
import { textToBytes, bytes2Text, bytesToHex, hexToBytes } from './utils/utils';
import { Method } from './method';
import { Message } from './message';

export class MessageSerialiser {
  
  static Instance = new MessageSerialiser();

  encode(msg: Message): Uint8Array {
    let list = [];

    list.push(msg.id ? hexToBytes(msg.id) : Message.genId());

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
    /* #4 headers */
    if (msg.headers) {
      let bytes = textToBytes(JSON.stringify(msg.headers));
      list.push(varint.encode((bytes.length << 3) | 4));
      list.push(bytes);
    }
    /* #5 streaming flags */
    if (msg.flags){
      list.push(varint.encode((msg.flags << 3) | 5));
    }    
    /* #6 - reserved */

    /* #7 - data type + body bytes */
    if (msg.body) {
      if (typeof (msg.body) == "string") {
        let bytes = textToBytes(msg.body);
        list.push(varint.encode((DataType.String << 3) | 7));
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

    //return <Uint8Array><any>pako.deflate(buffer);
    return buffer;
  }

  decode(binary: Uint8Array): Message {
    //binary = pako.inflate(binary);
    let msg: Message = {};
    let off = 0;

    msg.id = bytesToHex(binary.slice(0, off += 8));

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
        case 4: //headers
          len = enc >> 3;
          msg.headers = JSON.parse(bytes2Text(binary.subarray(off, off += len)));
          break;
        case 5: //stream flags;
          msg.flags = enc >> 3;
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