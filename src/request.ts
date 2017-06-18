import { Message } from './message';
import { Method } from './method';
import { Body } from './body';

export interface Request {
  id: string;
  method: Method;
  path?: string;
  body?: Body;
}