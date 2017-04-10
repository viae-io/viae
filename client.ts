import * as Ws from 'ws';
import * as readline from 'readline';
import { Via } from './src/index';

let ws = new Ws("ws://localhost:9090");
let via = new Via(ws);

ws.on("open", () => {
  via.request({ method: "PING", path: "/" }).then(x => {
    console.log("PONG!");
  });

  via.request({ method: "GET", path: "/greet" }).then((ctx) => {
    if (isPipeable(ctx.res.body)) {
      ctx.res.body.pipe(process.stdout);
      return false;
    } else {
      console.log(ctx.res.body);
    }
  });

  via.send({ method: "GET", path: "/nothing" });

  via.request({ method: "GET", path: "/exception" }).then((ctx) => {
    console.log(ctx.res.body);
  });
});

function isPipeable(obj) {
  return obj.pipe !== undefined && typeof (obj.pipe) == "function";
}
