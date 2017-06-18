import { Rowan } from 'rowan';
import { RequestContext } from '../context';
import { Method } from '../method';
import { Message } from '../message';
import { Status } from '../status';
import { Wire } from '../wire';
import { request, requestPath, requestMethod } from '../middleware';

/* routes requests for a iterable */

export class IterableRouter extends Rowan<RequestContext> {
  constructor(iterable: Iterable<any> | AsyncIterable<any>, dispose: () => void) {
    super();

    let iterator: Iterator<any>;

    this.use(
      requestMethod(Method.SUBSCRIBE),
      (ctx: RequestContext) => {
        try {
          if (iterator !== undefined)
          { throw Error("Already subscribed"); }
          if (iterable[Symbol.asyncIterator])
            iterator = iterable[Symbol.asyncIterator]();
          else
            iterator = iterable[Symbol.iterator]();
          ctx.send(undefined, Status.Ok);
        } catch (err) {
          ctx.send(err.message, Status.Error);
        }
      });

    this.use(
      request(),
      requestMethod(Method.NEXT),
      async (ctx: RequestContext) => {
        let body: any;
        let status: Status;

        try {
          let result = await iterator.next();
          body = result.value;
          status = result.done ? Status.Done : Status.Next;
        } catch (err) {
          body = err.message;
          status = Status.Error;
        }
        ctx.send(body, status);
        if (status != Status.Next) {
          dispose();
        }
      });

    this.use(
      request(),
      requestMethod(Method.UNSUBSCRIBE),
      (ctx: RequestContext) => {
        ctx.send(undefined, Status.Ok);
        dispose();
      });
  }
}