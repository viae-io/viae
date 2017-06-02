import { Wire } from './wire';
import { ViaRequest } from './request';
import { ViaResponse } from './response';
import { ViaMessage } from './message';
import { ViaStatus } from './status';

export interface ViaContext {
  wire: Wire;
  $done?: true;
}

export interface ViaRequestContext extends ViaContext {
  params?: any;
  req: ViaRequest;
  send(body: any, status: ViaStatus);
};

export interface ViaResponseContext extends ViaContext {
  res: ViaResponse;  
}
export function isResponse(ctx: ViaContext): ctx is ViaResponseContext {
  return ctx["res"] !== undefined;
}

export function isRequest(ctx: ViaContext): ctx is ViaRequestContext {
  return ctx["req"] !== undefined;
}