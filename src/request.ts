import { Message } from './message';
import { Method } from './method';

export type RequestBody = string | Uint8Array | object | { $stream: AsyncIterableIterator<string | Uint8Array | object>; }

export interface Request {
  id: string;
  method: Method;
  path?: string;
  body?: RequestBody;
}