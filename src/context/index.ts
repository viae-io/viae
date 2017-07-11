import { Handler, Processor, RowanContext } from 'rowan';

import { Wire } from '../wire';
import { Request } from '../request';
import { Response } from '../response';
import { Message } from '../message';
import { Status } from '../status';
import { Method } from '../method';
import { Via } from '../via';

export type ContextHandler = Handler<Context>;
export type ContextProcessor = Processor<Context>;

export interface Context extends RowanContext {
  id: string;
  connection: Via;  
  [index: string]: any;
}

export interface ResponseContext extends Context {
  res: Response;
}

export interface RequestContext extends ResponseContext {
  params?: any;
  req: Request;  
  send(msg: Message);
};

export function isResponse(ctx: Context): ctx is ResponseContext {
  return ctx["res"] !== undefined;
}

export function isRequest(ctx: Context): ctx is RequestContext {
  return ctx["req"] !== undefined;
}

export function isResponseMessage(msg: Message): msg is Response {
  return msg.status != undefined;
}

export function isRequestMessage(msg: Message): msg is Request {
  return msg.status == undefined;
}

export class ContextFactory {
  constructor(private via: Via) {
  }

  create(message: Message, connection: Via): Context {
    if (isResponseMessage(message)) {
      return {
        id: message.id,
        res: message,
        connection: connection
      } as ResponseContext;
    }
    else {
      let ctx: RequestContext = {
        id: message.id as string,
        req: message as Request,
        res: {
          id: message.id,
          status: 200,
        },
        connection: connection,
        send: (msg: Message) => {          
          let _msg = ctx.res;
          Object.assign(_msg, msg);
          _msg.status = _msg.status;
          _msg.id = ctx.id;
          this.via.send(_msg);
          delete ctx.send;
          ctx.$done = true;
          ctx.res = _msg;
        }
      }

      return ctx;
    }
  }
}