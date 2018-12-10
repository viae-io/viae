import { Rowan } from "rowan";
import { Router } from "./middleware";

/***/
export class App extends Rowan {
  constructor(opts: { controllers: any[] }) {
    super();
    let { controllers } = opts;
    for (let controller of controllers) {
      let router = Router.fromController(controller);
      if (router) {
        this.use(router);
      }
    }
  }
}

