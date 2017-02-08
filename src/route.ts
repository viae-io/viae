import { Rowan } from 'rowan';
import { Via, ViaHandler, ViaContext } from './via';
import { PathRequest, requestPath, requestMethod } from './middleware';
import { Method } from './method';

export class Route extends Rowan<ViaContext> {
  constructor() {
    super();
  }

  get(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.GET, path, handler, ...handlers);
  }

  put(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.PUT, path, handler, ...handlers);
  }

  post(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.POST, path, handler, ...handlers);
  }

  patch(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.PATCH, path, handler, ...handlers);
  }

  delete(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.DELETE, path, handler, ...handlers);
  }

  subscribe(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.SUBSCRIBE, path, handler, ...handlers);
  }

  unsubscribe(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.method(Method.UNSUBSCRIBE, path, handler, ...handlers);
  }

  method(method: Method, path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.use(requestMethod(method), requestPath(path), handler, ...handlers);
  }

  path(path: PathRequest, handler: ViaHandler, ...handlers: ViaHandler[]) {
    return this.use(requestPath(path), handler, ...handlers);
  }
}