import "reflect-metadata";
import { ConsoleLog } from "./log";

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

const _nolog = new ConsoleLog();

export function Trace() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // keep a reference to the original function
    const originalValue = descriptor.value;

    // Replace the original function with a wrapper
    descriptor.value = function (...args: any[]) {
      const ctx = args[0] || {};
      const log = ctx.log || _nolog;

      log.debug(`=> ${propertyKey}(${args.join(", ")})`);

      // Call the original function
      var result = originalValue.apply(this, args);

      log.debug(`<= ${result}`);
      return result;
    };
  };
};