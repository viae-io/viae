import {ViaHandler, ViaInterceptor} from '../via-types';
import {ViaContext} from '../context';
import {Rowan} from 'rowan';

export function intercept(host: { interceptors: Map<string, ViaInterceptor> }) {
  return async (ctx: ViaContext) => {
    if ((ctx.res.id || ctx.req.id) == undefined)
      return;
    const interceptor = host.interceptors.get((ctx.res.id || ctx.req.id));
    if (interceptor != undefined) {
      return await Rowan.execute(ctx, undefined, interceptor.handlers);
    }
  };
}