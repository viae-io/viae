import { Viae, Context } from './src';
import { Server as WebSocketServer } from 'ws';
import { Wire } from './src';
import { Router } from './src/middleware';
import * as ora from 'ora';
import { App } from './src/app';
import { Controller, Get, Data, Param } from './src/decorators';
import { Middleware } from 'rowan';


let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

/*const spinner = ora('Profiling...').start();
let messages = 0;

setInterval(() => {
  spinner.color = "green";
  spinner.text = 'Profiling... tps: ' + Math.round(messages);
  messages = 0;
}, 2000);

/*viae.before(async (ctx, next) => {
  await next();
  messages += 1;
});*/

server.on("error", (error) => {
  console.log("connection error");
});

@Controller('echo')
class ProjectController {
  @Get(":id")
  echo(@Data() name: string, @Param("id") id: string) {
    return "hello " + name;
  }
}

viae.use(new App({
  controllers: [new ProjectController()]
}));

function printTree(process: Middleware<any>, offset = 0) {
  console.log( process.constructor.name);
  if (process["middleware"]) {
    for (let item of process["middleware"]) {
      printTree(item, offset += 1);
    }
  }
}

printTree(viae);

