
import { Context, RequestContext, ResponseContext } from '../context';
import { Rowan, If, Middleware } from "rowan";
import { request } from "./request";
import { WireState } from '@viae/core';

export class ReadableStreamSender extends Rowan<RequestContext> {
  private _complete: Promise<void>;
  constructor(readable: ReadableStream<any>, dispose: () => void) {
    super();

    let reader: ReadableStreamDefaultReader<any>

    let resolve, reject;

    this._complete = new Promise<void>((r, x) => {
      resolve = r;
      reject = x;
    })

    this.use(new If(request("START"), [
      async (ctx, next) => {
        if (reader != null) { throw Error("Already reading"); }
        let sid = ctx.in.id;
        let via = ctx.connection;
        //Remove default response. 
        delete ctx.out;
        reader = readable.getReader();
        async function flush() {
          try {
            while (reader) {
              let next = await reader.read();
              if (next.done) {
                await via.send({ id: sid, head: { status: 200 } });
                dispose();
                resolve();
                reader = null;
              } else {
                await via.send({ id: sid, head: { status: 206 }, data: next.value });
              }
            }
          } catch (err) {
            if (via.wire.readyState == WireState.OPEN) {
              try {
                await via.send({ id: sid, head: { status: 500 }, data: err });
              } catch (_err) { }
            } try {
              if (reader) {
                reader.cancel();
              }
            } catch (_err) { }
            reject(err);
          }
        }

        flush();

        readable = null;
      }
    ]));

    this.use(new If(request("ABORT"), [
      async (ctx, next) => {
        if (reader) {
          reader.cancel(); // this feeds back to the read that its cancelled
          reader = null;
        }
        ctx.send({ head: { status: 200 } });
        //resolve gracefully
        resolve();
      }]));
  }

  get complete() {
    return this._complete
  }
}

export function isReadableStream(obj: any): obj is ReadableStream<any> {
  if (obj == null) return false;
  if (obj instanceof ReadableStream) return true;
  if (obj.getReader != null) return true;
  return false;
}

export class UpgradeOutgoingReadableStream implements Middleware<Context> {
  meta: {
    type: "OutgoingReadableStream"
  }
  async process(ctx: Context, next: () => Promise<void>) {

    if (!ctx) return next();

    const head = ctx.out.head;
    const data = ctx.out.data;

    if (isReadableStream(data)) {

      let readable = data;
      let sid = ctx.connection.createId();
      let router = new ReadableStreamSender(readable, function () { dispose(); });
      let dispose = ctx.connection.intercept(sid, [router]);

      ctx.tasks.push({ name: "ReadableStreamSender", complete: router.complete },)

      head["readable"] = sid;

      delete ctx.out.data;
    }

    await next();
  }
}

export class UpgradeIncomingReadableStream implements Middleware<Context> {
  meta: {
    type: "IncomingReadableStream"
  }
  process(ctx: Context, next: () => Promise<void>) {
    if (!ctx.in || !ctx.in.head || typeof ctx.in.head["readable"] !== "string") {
      return next();
    }

    const sid = ctx.in.head["readable"] as string;
    const connection = ctx.connection;

    let dispose;

    //TODO: this needs reworking to incorporate a buffer 
    // for incoming instead of pushing them directly into the controller. 
    // with a buffer, it should be possible to use the pull mechanic 
    // instead of free-flowing without backpressure

    ctx.in.data = new ReadableStream({
      async cancel() {
        if (dispose) {
          connection.send({ id: sid, head: { method: "ABORT" } });
          dispose();
          dispose = null;
        }
      },
      async start(controller) {
        let streamer = new Promise<void>(async (resolve, reject) => {
          dispose = connection.intercept(sid, [
            async (ctx: ResponseContext) => {
              let res = ctx.in;
              let status = res.head.status;
              let data = res.data;
              if (status == 206) {
                controller.enqueue(data);
                /*if(controller.desiredSize <= 0){
                  await connection.send({ id: sid, head: { method: "THROTTLE" } });
                }*/
              } else if (status == 500) {
                reject(data);
              } else {
                controller.close();
                resolve();
              }
            }])
        });
        //we're ready to capture incoming messages       

        await connection.send({ id: sid, head: { method: "START" } });
        await streamer;
        if (dispose()) { dispose(); dispose = null };
      }
    }, new CountQueuingStrategy({ highWaterMark: 32 }))

    return next();
  }
}