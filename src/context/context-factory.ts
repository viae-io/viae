import { Context, ContextHandler } from './';
import { Message } from '../message';
import { Method } from '../method';
import { Status } from '../status';
import { Wire } from '../wire';
import { Via } from '../via';


export class ContextFactory {
  constructor(private via: Via) {
  }

  create(message: Message, connection: Via): Context {
    let ctx: Context;

    if (message.status) {
      ctx = {
        id: message.id,
        res: message,
        connection: connection
      };
    }
    else {
      ctx = {
        id: message.id,
        req: message,
        connection: connection,
        send: (msg: Message) => {          
          let _msg = ctx.res || {};      
          Object.assign(_msg, msg);
          _msg.status = _msg.status || 200;
          _msg.id = ctx.id;
          this.via.send(_msg);
          delete ctx.send;
          ctx.$done = true;
          ctx.res = _msg;
        }
      };
    }
    return ctx;
  }
}