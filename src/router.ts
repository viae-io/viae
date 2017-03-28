import { Rowan } from 'rowan';
import { ViaHandler, ViaContext } from './via';
import { requestPath, requestMethod } from './middleware';

export class Router extends Rowan<ViaContext>{
  route(opts: {
    path: string,
    method: string,
    handlers: ViaHandler[]
  }) {
    this.use(
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}