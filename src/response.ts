import { Status } from './status';
import { Body } from './body';

export interface Response {
  id: string;
  status: Status;
  body?: Body;
};
