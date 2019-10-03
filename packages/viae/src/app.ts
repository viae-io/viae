import { Rowan } from "rowan";
import { Router } from "./middleware";

/***/
export class App extends Rowan {
  constructor(opts: { controllers: any[], root?: string }) {
    super();
    this.meta = { type: "App" };
    let { controllers, root } = opts;
    for (let controller of controllers) {
      let router = Router.fromController(controller, root);
      if (router) {
        this.use(router);
      }
    }
  }
}

