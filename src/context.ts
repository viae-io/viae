import { IRowan, Middleware, Handler, AutoHandler, Rowan, } from "rowan";
import Via from "./via";
import { Message, MessageHeader, encode, decode } from "./message";
import { Status } from "./status";

export interface Context {
  id: string;
  connection: Via<Context>;

  in?: Request | Response;
  out?: Request | Response;

  isReq(inbound?: boolean): this is RequestContext;
  isRes(inbound?: boolean): this is ResponseContext;
}

export interface ContextConstructor<Ctx extends Context = Context> {
  new(init: { connection: Via<Ctx>; in: ArrayBuffer }): Ctx;
  new(init: { connection: Via<Ctx>; out: Response | Request }): Ctx;
}

export class DefaultContext implements Context {
  id: string;
  connection: Via<Context>;

  in?: Request | Response;
  out?: Request | Response;

  get req() {
    return (this.in || this.out) as Request;
  }

  get res() {
    return (this.out || this.in) as Response;
  }

  constructor(init: { connection: Via<Context>; in?: ArrayBuffer, out?: Response | Request }) {
    this.connection = init.connection;

    this.out = init.out;

    /* Create Inbound Context */
    if (init.in) {
      const message = decode(init.in);
      const { head, body } = message;
      this.id = head.id;

      if (head.status) {
        this.in = {
          head: head,
          body: body,
          status: head.status
        };
      } else {
        this.in = {
          head: head,
          body: body,
          path: head.path,
          method: head.method
        };
        this.out = this.out || this.defaultResponse(this.in);
      }
    }
  }

  isReq(inbound = true): this is RequestContext {
    return (inbound) ?
      this.in !== undefined && this.in.head.status === undefined :
      this.out !== undefined && this.out.head.status === undefined;
  }

  isRes(inbound = true): this is ResponseContext {
    return (inbound) ?
      this.in !== undefined && this.in.head.status !== undefined :
      this.out !== undefined && this.out.head.status !== undefined;
  }

  private defaultResponse(req: Request): Response {
    return {
      head: { id: req.head.id },
      status: 404
    };
  }
}

export interface Response<Body = any> extends Message<Body> {
  status: Status;
}

export interface Request<Body = any> extends Message<Body> {
  path: string;
  method: string;
}

export interface RequestContext extends ResponseContext {
  req: Request;
}

export interface ResponseContext extends Context {
  res: Response;
}