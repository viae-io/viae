import { Wire } from '../wire';
import { Request } from '../request';
import { Response } from '../response';
import { Message } from '../message';
import { Status } from '../status';
import { Handler, IProcessor } from 'rowan';
import { Context } from './context';
export { Context } from './context';
export { ContextFactory } from './context-factory';

export type ContextHandler = Handler<Context>;
export type ContextProcessor = IProcessor<Context>;

export interface RequestContext extends Context {
  params?: any;
  req: Request;
  send(body: any | undefined, status?: Status);
};

export interface ResponseContext extends Context {
  res: Response;
}

export function isResponse(ctx: Context): ctx is ResponseContext {
  return ctx["res"] !== undefined;
}

export function isRequest(ctx: Context): ctx is RequestContext {
  return ctx["req"] !== undefined;
}
