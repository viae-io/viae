import { Viae, Context } from './src';
import { Server as WebSocketServer } from 'ws';
import { Wire } from './src';
import { Router } from './src/middleware';
import * as ora from 'ora';

let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

const spinner = ora('Profiling...').start();
let messages = 0;

setInterval(() => {
  spinner.color = "green";
  spinner.text = 'Profiling... mps: ' + Math.round(messages / 2);
  messages = 0;
}, 2000);

viae.before(async (ctx, next) => {
  await next();
  messages += 1;
});

viae.on("connection", (via) => {
  console.log("client connected");
  via.on("close", () => {
    console.log("client disconnected");
  });
});

let router = new Router({ root: "/" });

router.route({
  method: "GET",
  path: "/echo",
  process: [async (ctx, next) => {
    ctx.out = {
      id: ctx.in.id,
      head: { status: 200 },
      data: {
        [Symbol.asyncIterator]: async function* () {
          yield 1;
          yield 2;
          yield 3;
        }
      }
    };
  }]
});

viae.use(router);

server.on("error", (error) => {
  console.log("connection error");
});
