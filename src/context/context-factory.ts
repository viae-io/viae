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
        send: (body: Body | undefined, status: Status = 200) => {
          let msg = { status: status };
          this.via.send({ id: ctx.id, status: status, body: body });
          delete ctx.send;
          ctx.$done = true;
          ctx.res = (body != undefined) ? { status: status, body: body } : { status: status };
        }
      };
    }
    return ctx;
  }
}