import { Wire } from './wire';
import { Request } from './request';
import { Response } from './response';
import { Message } from './message';
import { Status } from './status';

export interface Context {
  id: string;
  $done?: true;
  wire: Wire;
}

export interface RequestContext extends Context {
  params?: any;
  req: Request;
  send(body: any | undefined, status: Status);
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