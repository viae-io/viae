import { Viae } from './src';
import { Server as WebSocketServer } from 'ws';
import { App } from './src/app';
import { Controller, Get, Data, Param, All, Next } from './src/decorators';
import { Middleware } from 'rowan';

let server = new WebSocketServer({ port: 8080, host: "localhost" });
let viae = new Viae(server);

server.on("error", (error) => {
  console.log("connection error");
});

@Controller('echo')
class ProjectController {

  @All("", { end: false })
  async findAll(@Next() next) {
    await next();
  }

  @Get()
  echo() {
    return "Hello ";
  }

  @Get(":name/:id")
  echoId(@Param("id") id: string, @Param("name") name: string) {
    return `Hello ${name} (${id})`;
  }
}

viae.use(new App({
  controllers: [new ProjectController()]
}));

function printTree(process: Middleware<any>, offset = 0) {
  console.log(process.constructor.name.padStart(process.constructor.name.length + offset));
  if (process["middleware"]) {
    for (let item of process["middleware"]) {
      printTree(item, offset + 1);
    }
  }
}
