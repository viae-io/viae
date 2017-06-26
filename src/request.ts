import { Message } from './message';
import { Method } from './method';

export interface Request {
  id: string;
  method: Method;
  path?: string;
  body?: any;
  [index: string]: any;
}