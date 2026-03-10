import { Status } from "./status.js";

export interface MessageHeader {
  method?: string;
  path?: string;
  status?: Status;
  encoding?: string;
  /** stream id for multiplexed streams */
  sid?: string;
  /** WHATWG-aligned backpressure signal: desired number of chunks (carried in PULL / START frames) */
  desiredSize?: number;
  /** full original path (set by router) */
  fullPath?: string;
  /** matched path segment (set by router) */
  matchedPath?: string;
  [key: string]: unknown;
}

export interface Message<T = any> {
  id: string;
  head: MessageHeader;
  data?: T;
  raw?: Uint8Array;
}

export interface Request<T = any> extends Message<T> {
  head: MessageHeader & {
    method: string;
    path: string;
  };
}

export interface Response<T = any> extends Message<T> {
  head: MessageHeader & {
    status: Status;
  };
}

export function isRequest<T>(msg: Message<T>): msg is Request<T> {
  return msg.head.method !== undefined && msg.head.status === undefined;
}

export function isResponse<T>(msg: Message<T>): msg is Response<T> {
  return msg.head.status !== undefined;
}
