import { Rowan } from 'rowan';
import { ViaHandler } from './via';
import { ViaContext } from './context';
import { ViaMethod } from './method';
import { request, requestPath, requestMethod } from './middleware';

export class Router extends Rowan<ViaContext>{
  route(opts: {
    path: string,
    method: ViaMethod,
    handlers: ViaHandler[]
  }) {
    this.use(
      request(),
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}