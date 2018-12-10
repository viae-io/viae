import { Status } from "./status";


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
export interface Frame {
  /* required: id */
  id: string;
  /* header */
  head?: MessageHeader;
  /* raw data payload */
  raw?: Uint8Array;
}

/**
 * message
 */
export interface Message<T = any> extends Frame {
  /* decoded data */
  data?: T;
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
    message.head.status == undefined;
}

export function isResponse<T>(message: Partial<Message<T>>): message is Request<T> {
  return message.head != undefined &&
    message.head.status != undefined;
}