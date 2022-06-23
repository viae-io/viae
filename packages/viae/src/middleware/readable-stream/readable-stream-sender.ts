import { Context, RequestContext } from '../../context';
import { Rowan, If } from "rowan";
import { request } from "../request";
import { IVia, SendOptions } from '../../_via';
import { EventBus } from './event-bus';

export class ReadableStreamSender extends Rowan<RequestContext> {
  constructor(readable: ReadableStream<any>, dispose: () => void, opts?:SendOptions) {

    super();
    
    let reader: ReadableStreamDefaultReader<any>;
    let sid: string;
    let via: IVia<Context>;
    let paused = true;

    async function flush() {
      paused = false;
      console.log("flowing...");
      try {
        while (reader && !paused) {
          let next = await reader.read();
          if (next.done) {
            await via.send({ id: sid, head: { status: 200 } });
            reader = null;
            setTimeout(dispose, 1000);
          }
          else {
            await via.send({ id: sid, head: { status: 206 }, data: next.value }, opts);
          }
        }
      }
      catch (err) {
        await via.send({ id: sid, head: { status: 500 }, data: err });
      }
    }

    this.use(new If(request("START"), [
      async (ctx, next) => {
        console.log("outgoing start");
        if (reader != null) {
          throw Error("Already reading");
        }
        sid = ctx.in.id;
        via = ctx.connection;
        ctx.send({ head: { status: 200 } });
        reader = readable.getReader();
        paused = false;
        flush();
        readable = null;
      }
    ]));
    this.use(new If(request("THROTTLE"), [
      async (ctx, next) => {
        ctx.send({ head: { status: 200 } });
        paused = true;
        console.log("paused...");
      }
    ]));
    this.use(new If(request("PULL"), [
      async (ctx, next) => { 
        ctx.send({ head: { status: 200 } });
        if (paused) {
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
      }
    ]));
  }
}
