import { Status } from "./status";
import { textToBytes, flatten, bytesToText, bytesToHex, hexToBytes } from './util';
import * as varint from 'varint';

/** message header */
export interface MessageHeader {
  /* request: resource path */
  path?: string;
  /* request: method */
  method?: string;
  /* response: status code */
  status?: Status;
  /* encoding used on body */
  encoding?: string;

  [index: string]: any;
}

/**
 * message
 */
export interface Message<MessageBody = any> {
  /* required: id */
  id: string;
  /* header */
  head?: MessageHeader;
  /* body */
  body?: MessageBody;
}

export function encode(message: Message<Uint8Array>): ArrayBuffer {
  let id = textToBytes(message.id);
  let head = textToBytes(JSON.stringify(message.head));
  let body = message.body;

  let parts = [
    varint.encode(id.length),
    id,
    varint.encode(head.length),
    head,
    ...(body) ? [body] : []];
  let binary = flatten(parts);

  return binary.buffer as ArrayBuffer;
}

export function decode(buffer: ArrayBuffer): Message<Uint8Array> {
  const raw = new Uint8Array(buffer);
  let offset = 0;

  let idLength = varint.decode(raw, offset); offset += varint.decode.bytes;
  let idBytes = raw.subarray(offset, offset + idLength); offset += idLength;
  let headLength = varint.decode(raw, offset); offset += varint.decode.bytes;
  let headBytes = raw.subarray(offset, offset + headLength); offset += headLength;
  let bodyBytes = (offset < raw.length) ? raw.subarray(offset) : null;

  let msg: Message = {
    id: bytesToText(idBytes),
  };

  if (headBytes.length > 0) msg.head = JSON.parse(bytesToText(headBytes));
  if (bodyBytes) msg.body = bodyBytes;

  return msg;
}

export interface Response<Body = any> extends Message<Body> {
  head: {
    status: Status;
  };
}

export interface Request<Body = any> extends Message<Body> {
  head: {
    path: string;
    method: string;
  };
}

export function isRequest<T>(message: Partial<Message<T>>): message is Request<T> {
  return message.head != undefined &&
    message.head.method != undefined &&
    message.head.path != undefined &&
    message.head.status == undefined;
}