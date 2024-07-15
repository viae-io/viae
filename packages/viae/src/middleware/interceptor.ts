import { Context } from '../context';
import { Rowan, Processor, Middleware } from 'rowan';
import { Disposer } from '../_disposer';
import { Log } from '../log';

type InterceptConfig<Ctx extends Context = Context> = {
  dispose: () => void,
  timestamp: number,
  middleware: Middleware<Ctx>[]
};

export type InterceptOptions<Ctx extends Context = Context> = {
  id: string;
  handlers: Processor<Ctx>[];
};

/** 
 * used to intercept messages with matching message ids and terminate further processing
 **/
export default class Interceptor<Ctx extends Context = Context> implements Middleware<Ctx> {

  private _interceptors = new Map<string, InterceptConfig>();

  meta: {
    type: "Interceptor"
  }

  constructor(private _log: Log){
  }
  
  /**
   * intercept any message with a matching id
   * @param id: message id to intercept
   * @param handlers: handlers or middleware
   * @returns method to remove (dispose) the interception entry.`
   */
  intercept(opt: InterceptOptions): () => void {
    const { id, handlers } = opt;
    const log = this._log;

    if (id == undefined) throw Error("id cannot be undefined");
    if (id.length == 0) throw Error("id cannot be empty");
    if (handlers == undefined) throw Error("handlers cannot be undefined");
    if (handlers.length == 0) throw Error("handlers length cannot be zero");

    const dispose: Disposer = () => {
      //console.log("disposed interceptor for", id);
      log.trace("intercept dispose " + id) ;   
      this._interceptors.delete(id);
    };

    const middleware = handlers.map(x => Rowan.convertToMiddleware(x));

    if (this._interceptors.has(id)) {
      throw Error("Already intercepting messages for id: " + id);
    }
    log.trace("intercepting " + id);
    this._interceptors.set(id, {
      dispose: dispose,
      timestamp: Date.now(),
      middleware: middleware
    });

    return dispose;
  }

  /** 
   * re-route processing to an interceptor's middleware
   */
  async process(ctx: Context, next): Promise<void> {
    const id = ctx.in.id;

    if (this._interceptors.has(id)) {
      const interceptor = this._interceptors.get(id);

      if (interceptor) {
        return Rowan.process(interceptor.middleware, ctx, next);
      }
    }
    
    return next();
  };

  dispose() {
    for (let [key, value] of this._interceptors.entries()) {
      value.dispose();
    }
  }

  private _checkTimeout() {
    let now = Date.now();
    for (let [key, value] of this._interceptors.entries()) {
      let span = now - value.timestamp;
      if (span > 5000) {
        value.dispose();
      }
    }
  }
}