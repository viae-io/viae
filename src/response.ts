import { Status } from './status';

type Basic = string | Uint8Array | object;
type Stream = { $stream: AsyncIterableIterator<Basic>; };

export interface Response {
  id: string;
  status: Status;
  body?: Basic | Stream;
};

