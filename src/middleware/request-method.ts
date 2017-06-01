import { ViaRequestContext } from '../context';
import { ViaMethod } from '../method';

/* the message is a request with a method matching the parameter */
export function requestMethod(method: ViaMethod) {
  return (ctx: ViaRequestContext) => {
    return ctx.req.method === method;
  };
}