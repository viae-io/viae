import { Status, MessageFrame, MessageHeader } from '@viae/core';

/**
 * message
 */
export interface Message<T = any> extends MessageFrame {
  /* decoded data */
  data?: T;
}

export interface Response<Body = any> extends Message<Body> {
  data?: Body;
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