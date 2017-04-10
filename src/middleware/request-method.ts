import { ViaContext } from '../context';

/* the message is a request with a method matching the parameter */
export function requestMethod(method: string) {
  return (ctx: ViaContext) => {
    return ctx.req.method === method;
  };
}