export type Streamable = {
  $stream: IterableIterator<string | Uint8Array | object> | AsyncIterableIterator<string | Uint8Array | object>
};

import { Rowan } from 'rowan';
import { ViaHandler } from './via';
import { ViaRequestContext } from './context';
import { ViaMethod } from './method';
import { ViaMessage } from './message';
import { ViaStatus } from './status';
import { request, requestPath, requestMethod } from './middleware';

export class Stream extends Rowan<ViaRequestContext>{

  constructor(iterable: Iterable<any>, dispose: () => void) {
    super();

    let iterator: Iterator<any>;

    this.use(
      requestMethod(ViaMethod.SUBSCRIBE),
      (ctx: ViaRequestContext) => {
        try {
          iterator = iterable[Symbol.iterator]();
          ctx.send(undefined, ViaStatus.OK);
        } catch (err) {
          ctx.send(err.message, ViaStatus.Error);     
        }
      });

    this.use(
      request(),
      requestMethod(ViaMethod.NEXT),
      (ctx: ViaRequestContext) => {
        let body: any;
        let status: ViaStatus;

         console.log("next");

        try {
          let result = iterator.next();
          body = result.value;
          status = result.done ? ViaStatus.Done : ViaStatus.Next;
        } catch (err) {
          body = err.message;
          status = ViaStatus.Error;
        }
        ctx.send(body, status);

        if (status != ViaStatus.Next) {
          dispose();
        }
      });

    this.use(
      request(),
      requestMethod(ViaMethod.UNSUBSCRIBE),
      (ctx: ViaRequestContext) => {
        dispose();
        ctx.send(undefined, ViaStatus.OK);
      });
  }
}