import { ViaContext } from '../via';
import { Method } from '../method';

/* the message is a request with a method matching the parameter */
export function requestMethod(method: Method) {
  return (ctx: ViaContext) => {
    return ctx.req.method === method;
  };
}