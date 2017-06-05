import { Context, isResponse, isRequest } from '../context';
import { ViaProcessor, ViaHandler } from '../via';
import { Rowan } from 'rowan';

type InterceptConfig = {
  dispose: () => void,
  timestamp: number,
  handlers: ViaHandler[]
};

/** used to intercept messages with matching request/response ids */
export class Interceptor implements ViaProcessor {
  private _interceptors = new Map<string, InterceptConfig>();

  /**
   * intercept any message with a matching res/req id
   * @param id: message id to incercept 
   * @param handlers: 1 or more handlers 
   * @returns method to remove (dispose) the interception entry. 
   */
  intercept(id: string, handlers: ViaHandler[]): () => void {
    if (id == undefined) throw Error("id cannot be undefined");
    if (id.length == 0) throw Error("id cannot be empty");
    if (handlers == undefined) throw Error("handlers cannot be undefined");
    if (handlers.length == 0) throw Error("handlers length cannot be zero");

    let dispose = () => this._interceptors.delete(id);

    this._interceptors.set(id, {
      dispose: dispose,
      timestamp: Date.now(),
      handlers: handlers
    });

    return dispose;
  }

  /**
   * @internal 
   */
  async process(ctx: Context, err: any) {
    if (err) return;

    const id = isRequest(ctx) ? ctx.req.id : isResponse(ctx) ? ctx.res.id : undefined;

    if (!id) return;

    const interceptor = this._interceptors.get(id);

    if (interceptor) {
      ctx["$intercepted"] = true;
      return await Rowan.execute(ctx, undefined, interceptor.handlers);
    }
  };
}
