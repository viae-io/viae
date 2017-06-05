import { Rowan } from 'rowan';
import { ViaHandler } from './via';
import { Context } from './context';
import { Method } from './method';
import { request, requestPath, requestMethod } from './middleware';

export class Router extends Rowan<Context>{
  route(opts: {
    path: string,
    method: Method,
    handlers: ViaHandler[]
  }) {
    this.use(
      request(),
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}