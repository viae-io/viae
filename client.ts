import * as Ws from 'ws';
import * as readline from 'readline';
import { Via } from './src/index';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

let ws = new Ws("ws://localhost:9090", "viae");
let via = new Via(ws);

via.use((ctx) => {
  if (isPipeable(ctx.res.body)) {

    ctx.res.body.pipe(process.stdout, { end: false });
    return false;
  } else {
    console.log(ctx.res.body);
  }
});

rl.on("line", (line) => {
  via.request({ method: "GET", path: "/greet", body: line });
});

function isPipeable(obj): obj is { pipe: (stream: any, opts?: any) => void } {
  return obj.pipe !== undefined && typeof (obj.pipe) == "function";
}

setInterval(() => {
  via.request({ method: "PING", path: "/" }).then(x => {
    console.log("PONG!");
  });
}, 3000);