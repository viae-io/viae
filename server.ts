import { Server } from 'ws';
import { Viae, ViaContext } from './src/index';



let wss = new Server({ port: 9090 });
let server = new Viae(wss);

server.route({
  method: "GET",
  path: "/greet",
  handlers: [
    (ctx) => {
      ctx.begin();
      ctx.send("hello ");
      ctx.send("w");
      ctx.send("o");
      ctx.send("r");
      ctx.send("l");
      ctx.send("d");
      ctx.send("\n");
      ctx.end();
      return false;
    }]
});

server.route({
  method: "PING",
  path: "/",
  handlers: [(ctx: ViaContext) => ctx.sendStatus(200)]
});

server.route({
  method: "GET",
  path: "/exception",
  handlers: [(ctx: ViaContext) => { throw Error("something nasty happened"); }]
});

server.use((ctx) => {
  return 404;
});
server.use((ctx, err) => {
  if (typeof (err) == "number") {
    ctx.res.status = err;
  } else {
    ctx.res.body = JSON.stringify(err, Object.getOwnPropertyNames(err))
    ctx.res.status = 504;
  }
  return ctx.send();
});

server.before((ctx: ViaContext) => {
  ctx["_start"] = Date.now();
});

server.after((ctx: ViaContext) => {
  let start = ctx["_start"];
  let span = Date.now() - start;
  console.log(`${ctx.req.method} ${ctx.req.path} - ${ctx.res.status} (${span}ms)`);
});

console.log("Server Running on 9090....");