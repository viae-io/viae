import { ViaContext, ViaRequestContext, isRequest } from '../context';

/* the message is a request with a path matching the parameter */
export function request() {
  return (ctx: ViaContext) => {
    return isRequest(ctx);    
  };
}