import { Request } from './request';
import { Message } from './message';
import { Wire } from './wire';

export interface ViaContext {
  wire: Wire;
  
  req?: Request;
  res?: Message;

  begin?();
  send?(body?: string | Uint8Array | Object);
  end?(body?: string | Uint8Array | Object);
}