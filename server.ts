import { Server } from 'ws';
import { Viae } from './src/index';



let wss = new Server({ port: 9090 });
let server = new Viae(wss);

server.route({
  method: "GET",
  path: "/greet",
  handlers: [
    (ctx) => {
      ctx.begin();
      ctx.send("w");
      ctx.send("o");
      ctx.send("r");
      ctx.send("l");
      ctx.send("d");
      ctx.end();
      return false;
    }]
});

server.use((ctx) => {
  return 404;
});

server.use((ctx, err) => {
  console.log(err);
  if (typeof (err) == "number") {
    ctx.res.status = err;
  } else {
    ctx.res.status = 504;
  }
  return ctx.send();
});

console.log("Server Running on 9090....");