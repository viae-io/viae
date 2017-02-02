import { ViaContext } from '../via';
import { Method } from '../method';

export function methodHandler(method: Method) {
  return (ctx: ViaContext) => {
    return ctx.req.method === method;
  };
}