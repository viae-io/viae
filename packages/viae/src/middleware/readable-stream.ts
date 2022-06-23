
import { Context, RequestContext, ResponseContext } from '../context';
import { Rowan, If, Middleware } from "rowan";
import { request } from "./request";
import { IVia } from '../_via';

export class ReadableStreamSender extends Rowan<RequestContext> {
  constructor(readable: ReadableStream<any>, dispose: () => void) {
    super();

    let reader: ReadableStreamDefaultReader<any>
    let sid: string;
    let via: IVia<Context>;
    let paused = true;

    async function flush() {
      paused = false;
      try {
        while (reader && !paused) {
          let next = await reader.read();
          if (next.done) {
            await via.send({ id: sid, head: { status: 200 } });
            reader = null;
            dispose();
          } else {
            await via.send({ id: sid, head: { status: 206 }, data: next.value });
          }
        }
      } catch (err) {
        await via.send({ id: sid, head: { status: 500 }, data: err });
      }
    }

    this.use(new If(request("START"), [
      async (ctx, next) => {
        console.log("outgoing start");
        if (reader != null) { throw Error("Already reading"); }
        sid = ctx.in.id;
        via = ctx.connection;
        //Remove default response. 
        delete ctx.out;
        reader = readable.getReader();
        paused = false;

        flush();

        readable = null;
      }
    ]));

    this.use(new If(request("THROTTLE"), [
      async (ctx, next) => {
        console.log("outgoing throttle");
        //Remove default response. 
        delete ctx.out;
        paused = true;

        console.log("...throttled")
      }
    ]));

    this.use(new If(request("PULL"), [
      async (ctx, next) => {
        console.log("outgoing pull");
        //Remove default response. 
        delete ctx.out;
        if(paused){
          flush();
        }
      }
    ]));

    this.use(new If(request("ABORT"), [
      async (ctx, next) => {
        if (reader) {
          reader.cancel();
          reader = null;
        }
        ctx.send({ head: { status: 200 } });
      }]));
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
      console.log("upgrading outgoing stream");

      let readable = data;
      let sid = ctx.connection.createId();
      let router = new ReadableStreamSender(readable, function () { dispose(); });
      let dispose = ctx.connection.intercept(sid, [router]);

      head["readable"] = sid;

      delete ctx.out.data;
    }

    return next();
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

    //upgrade

    const sid = ctx.in.head["readable"] as string;
    const connection = ctx.connection;
    let dispose;

    ctx.in.data = new ReadableStream({
      async cancel() {
        if (dispose) {
          connection.send({ id: sid, head: { method: "ABORT" } });
          dispose();
          dispose = null;
        }
      },
      async start(controller) {
        dispose = connection.intercept(sid, [
          async (ctx: ResponseContext) => {
            let res = ctx.in;
            let status = res.head.status;
            let data = res.data;
            if (status == 206) {
              controller.enqueue(data);
              if (controller.desiredSize == 0) {
                await connection.send({ id: sid, head: { method: "THROTTLE" } });
              }
            } else if (status == 500) {
              controller.error(res.data);
              dispose();              
            } else {
              controller.close();
              dispose();   
            }
          }])
          
        //we're ready to capture incoming messages       

        await connection.send({ id: sid, head: { method: "START" } });
      },
      async pull(){
        await connection.send({ id: sid, head: { method: "PULL" } });
      }
    }, { highWaterMark: 128 })

    console.log("incoming to readable, return");

    return next();
  }
}