import "reflect-metadata";

function methodDecorator(method: string, path: string, opts?: { end?: boolean }) {
  return function (target: any, propertyKey: string | symbol, parameterDesc: TypedPropertyDescriptor<Function>) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.method = method;
    route.path = path;
    route.opts = opts || { end: true }
    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function All(path?: string, opts?: { end?: boolean }) {
  return methodDecorator(undefined, path || "", opts);
}

export function Get(path?: string, opts?: { end?: boolean }) {
  return methodDecorator("GET", path || "", opts);
}

export function Put(path?: string, opts?: { end?: boolean }) {
  return methodDecorator("PUT", path || "", opts);
}

export function Post(path?: string, opts?: { end?: boolean }) {
  return methodDecorator("POST", path || "", opts);
}

export function Delete(path?: string, opts?: { end?: boolean }) {
  return methodDecorator("DELETE", path || "/", opts);
}

export function Subscribe(path?: string, opts?: { end?: boolean }) {
  return methodDecorator("SUBSCRIBE", path || "/", opts);
}

export function Data() {
  return function (target: any, propertyKey: string | symbol, index: number) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.args = route.args || [];
    route.args[index] = { type: "data" };

    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Head() {
  return function (target: any, propertyKey: string | symbol, index: number) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.args = route.args || [];
    route.args[index] = { type: "head" };

    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Raw() {
  return function (target: any, propertyKey: string | symbol, index: number) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.args = route.args || [];
    route.args[index] = { type: "raw" };

    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Ctx() {
  return function (target: any, propertyKey: string | symbol, index: number) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.args = route.args || [];
    route.args[index] = { type: "ctx" };

    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Next() {
  return function (target: any, propertyKey: string | symbol, index: number) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.args = route.args || [];
    route.args[index] = { type: "next" };

    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Param(key: string) {
  return function (target: any, propertyKey: string | symbol, index: number) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.args = route.args || [];
    route.args[index] = { type: "param", opt: key };

    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Controller(root?: string) {
  return function (target: any): any {
    let router: any = Reflect.getMetadata("__router", target.prototype) || {};
    router.root = root || "";
    Reflect.defineMetadata("__router", router, target.prototype);
  };
}