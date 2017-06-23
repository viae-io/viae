import { Method } from './method';
import { Status } from './status';

export interface Message {
  id?: string;
  method?: Method;
  path?: string;
  status?: Status;
  body?: any;
  [index: string]: any;
}
