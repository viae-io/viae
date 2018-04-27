import { Context } from '../context';
import { Rowan, Processor, Middleware } from 'rowan';

type InterceptConfig<Ctx extends Context = Context> = {
  dispose: () => void,
  timestamp: number,
  middleware: Middleware<Ctx>[]
};

export type InterceptOptions<Ctx extends Context = Context> = {
  id: string;
  handlers: Processor<Ctx>[];
  terminate?: true;
};

/** 
 * used to intercept messages with matching message ids and terminate further processing
 **/
export default class Interceptor<Ctx extends Context = Context> implements Middleware<Ctx> {
  private _interceptors = new Map<string, InterceptConfig>();

  /**
   * intercept any message with a matching id
   * @param id: message id to intercept
   * @param handlers: handlers or middleware
   * @returns method to remove (dispose) the interception entry.`
   */
  intercept(opt: InterceptOptions): () => void {
    const { id, handlers, terminate } = opt;

    if (id == undefined) throw Error("id cannot be undefined");
    if (id.length == 0) throw Error("id cannot be empty");
    if (handlers == undefined) throw Error("handlers cannot be undefined");
    if (handlers.length == 0) throw Error("handlers length cannot be zero");

    let dispose = () => this._interceptors.delete(id);

    let middleware = handlers.map(x => Rowan.convertToMiddleware(x));

    if (terminate) {
      middleware.push({ process: () => Promise.resolve() });
    }

    //if (this._interceptors.has(id)) {
    // TODO: figure out what to do if an interceptor exists already
    //}

    this._interceptors.set(id, {
      dispose: dispose,
      timestamp: Date.now(),
      middleware: middleware
    });

    return dispose;
  }

  /** re-route processing to an interceptor if one found for the message id.
   * if the interceptor was configured to terminate, it won't call next. 
   * if an interceptor is not found, next is called and its result returned. 
  */
  async process(ctx: Context, next): Promise<void> {
    const id = ctx.id;

    if (!id) return undefined;

    const interceptor = this._interceptors.get(id);

    if (interceptor) {
      return Rowan.process(interceptor.middleware, ctx, next);
    }

    return next();
  };

  dispose() {
    for (let [key, value] of this._interceptors.entries()) {
      value.dispose();
    }
  }
}