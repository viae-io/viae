import { RequestContext } from '../context';
import { Method } from '../method';

/* the message is a request with a method matching the parameter */
export function requestMethod(method: Method) {
  return (ctx: RequestContext) => {
    return ctx.req.method === method;
  };
}