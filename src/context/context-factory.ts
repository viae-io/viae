import { Context, ContextHandler } from './';
import { Message } from '../message';
import { Method } from '../method';
import { Status } from '../status';
import { Wire } from '../wire';
import { Via } from '../via';
import { Body } from '../body';


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
        send: (msg: Message, opts: object) => {
          let _msg = Object.assign({ status: 200 }, msg);
          _msg.id = ctx.id;
          this.via.send(_msg, opts);
          delete ctx.send;
          ctx.$done = true;
          ctx.res = _msg;
        }
      };
    }
    return ctx;
  }
}