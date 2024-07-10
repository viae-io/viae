import { Status, MessageFrame, MessageHeader } from '@viae/core';

/**
 * message
 */
export interface Message<T = any> extends MessageFrame, Disposable {
  /* decoded data */
  data?: T;
}

export class MessageInstance implements Message {
  data?: any;
  id: string;
  head?: MessageHeader;
  raw?: Uint8Array;
  constructor(init: Partial<Message>){
    Object.assign(this, init);
  }  
  [Symbol.dispose](): void {
  }
}

export interface Response<Body = any> extends Message<Body> {
  data: Body;
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
    message.head.status == undefined;
}

export function isResponse<T>(message: Partial<Message<T>>): message is Request<T> {
  return message.head != undefined &&
    message.head.status != undefined;
}