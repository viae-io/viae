import { Status } from "./status";
import { textToBytes, flatten, bytesToText } from './util';

/** message header */
export interface MessageHeader {
  /* required: id */
  id?: string;

  path?: string;
  method?: string;
  status?: Status;

  encoding?: "none" | "msgpack" | "json";

  [index: string]: any;
}

/**
 * message
 */
export interface Message<MessageBody = any> {
  head?: MessageHeader;
  body?: MessageBody;
}

export function encode(message: Message<Uint8Array>): ArrayBuffer {
  let json = JSON.stringify(message.head);
  let head = textToBytes(json);
  let body = message.body;
  let length = json.length + (body ? body.length : 0) + 4;
  let tmp = new Uint8Array(length);

  tmp.set(new Uint8Array(new Uint32Array([json.length]).buffer, 0, 1));
  tmp.set(head, 4);
  if (body) {
    tmp.set(body, 4 + head.length);
  }
  return tmp.buffer as ArrayBuffer;
}

export function decode(buffer: ArrayBuffer): Message<Uint8Array> {
  const raw = new Uint8Array(buffer);
  if (raw.length < 4) throw Error("Message binary length invalid");
  let length = new Uint32Array(raw.slice(0, 4).buffer, 0, 1)[0];
  if (raw.length < 4 + length) throw Error("Message binary length invalid");

  let msg: Message = { head: JSON.parse(bytesToText(raw, 4, 4 + length)) };

  if (length + 4 < raw.length) {
    msg.body = new Uint8Array(raw.buffer, 4 + length + raw.byteOffset);
  }

  return msg;
}

