import { IRowan, Middleware, Handler, AutoHandler, Rowan, HasError } from "rowan";
import Via from "./via";
import { Message, MessageHeader, encode, decode } from "./message";
import { Status } from "./status";

export interface Context {
  id: string;
  connection: Via<Context>;

  in?: Message<any>;
  out?: Message<any>;

  req?: Request<any>;

  isReq(inbound?: boolean): this is RequestContext;
  isRes(inbound?: boolean): this is ResponseContext;
}

export interface ContextConstructor<Ctx extends Context = Context> {
  new(init: { connection: Via<Ctx>; in: Message<any> }): Ctx;
  new(init: { connection: Via<Ctx>; out: Message<any> }): Ctx;
}

export class DefaultContext implements Context {
  id: string;
  connection: Via<Context>;

  in?: Message<any>;
  out?: Message<any>;

  get req() {
    return (this.in || this.out) as Request;
  }

  get res() {
    return (this.out || this.in) as Response;
  }

  constructor(init: { connection: Via<Context>; in?: Message<any>, out?: Message<any> }) {
    this.connection = init.connection;

    this.out = init.out;
    this.in = init.in;

    //create request or response proxies to in/out
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

  private defaultResponse(req: Message<any>): Response {
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

export interface ErredContext extends Context, HasError {}