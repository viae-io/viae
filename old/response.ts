import { Status } from './status';

export interface Response {
  id: string;
  status: Status;
  body?: any;
  [index: string]: any;
};
