import { Status } from './status';

export type ResponseBody = string | Uint8Array | object | { $stream: AsyncIterableIterator<string | Uint8Array | object>; }

export interface Response {
  id: string;
  status: Status;
  body?: ResponseBody;
};

