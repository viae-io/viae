import { Message } from './message';
import { Method } from './method';

type Basic = string | Uint8Array | object;
type Stream = { $stream: AsyncIterableIterator<Basic>; };

export interface Request {
  id: string;
  method: Method;
  path?: string;
  body?: Basic | Stream;
}