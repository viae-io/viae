import { Message, Request, Response } from "./message";
import { Log } from "./log";
import { IVia } from "./_via";
import { Status } from "@viae/core";
import { Disposer } from "./_disposer";


export interface ContextTask {
  readonly name: string;
  readonly complete: Promise<void>
}

export interface Context extends AsyncDisposable {
  id: string;
  connection: IVia<Context>;
  err?: any;

  in?: Message<any>;
  out?: Message<any>;

  req?: Request<any>;
  res?: Response<any>;

  params?: { [key: string]: string }

  /*checks to see if inbound message is a request (default inbound = true)*/
  isReq(inbound?: boolean): this is RequestContext;

  /* checks to see if inbound message is a response (default inbound = true) */
  isRes(inbound?: boolean): this is ResponseContext;

  /** sub tasks that run separately*/
  readonly tasks: ContextTask[];
  readonly complete: Promise<void>;

  onDispose(cb:()=>void | Promise<void>): void;

  [key: string]: any;
}

export interface ContextConstructor<C extends Context = Context> {
  new(init: { connection: IVia<C>; in: Message<any>, log: Log }): C;
  new(init: { connection: IVia<C>; out: Message<any>, log: Log }): C;
}

export class DefaultContext implements Context {
  private _disposers: (()=>(Promise<void> | void))[] = [];
  private _tasks: ContextTask[] = [];

  id: string;
  connection: IVia<Context>;
  in?: Message;
  out?: Message;

  constructor(init: { connection: IVia<Context>; in?: Message, out?: Message }) {
    Object.assign(this, init);

    if (this.isReq()) {
      this.out = this.defaultResponse(this.in);
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

  private defaultResponse(req: Message<any>): Response {
    if (req) {
      return {
        id: req.id,
        head: { status: Status.NotFound }
      };
    }
  }

  send(msg: Message) {
    msg.id = typeof msg.id === "string" ? msg.id : this.in.id;
    this.out = msg;
  }

  get tasks(){
    return this._tasks;
  }
  get complete(){
    return Promise.all<void>(this._tasks.map(x=>x.complete)).then(function(){void 0});
  }

  onDispose(cb: () => void | Promise<void>): void {
      this._disposers.push(cb);
  }
  
  async [Symbol.asyncDispose](){
    await Promise.all(this._disposers);
    this._disposers = [];
  }
}

export interface RequestContext extends ResponseContext {
  req: Request;
}

export interface ResponseContext extends Context {
  res: Response;
}