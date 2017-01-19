import { Message } from './message';

export interface Request extends Message {
  params?: any;
}