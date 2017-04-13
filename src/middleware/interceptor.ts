import { ViaProcessor, ViaHandler, ViaContext } from '../via';
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
  async process(ctx: ViaContext, err: any) {
    if (!err) {
      const id = (ctx.req) ? ctx.req.id : (ctx.res) ? ctx.res.id : undefined;

      if (id) {
        const interceptor = this._interceptors.get(id);

        if (interceptor) {
          return await Rowan.execute(ctx, undefined, interceptor.handlers);
        }
      }
    }
  };
}
