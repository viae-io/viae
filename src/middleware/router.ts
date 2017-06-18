import { Rowan } from 'rowan';
import { Context, ContextHandler } from '../context';
import { Method } from '../method';
import { request, requestPath, requestMethod } from '../middleware';

export class Router extends Rowan<Context>{
  route(opts: {
    path: string,
    method: Method,
    handlers: ContextHandler[]
  }) {
    this.use(
      request(),
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}