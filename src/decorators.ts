import "reflect-metadata";

export function Get(path?: string) {
  return function (target: any, propertyKey: string | symbol, parameterDesc: TypedPropertyDescriptor<Function>) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.method = "GET";
    route.path = path || "";
    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Put(path?: string) {
  return function (target: any, propertyKey: string | symbol, parameterDesc: TypedPropertyDescriptor<Function>) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.method = "PUT";
    route.path = path || "";
    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Post(path?: string) {
  return function (target: any, propertyKey: string | symbol, parameterDesc: TypedPropertyDescriptor<Function>) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.method = "POST";
    route.path = path || "";
    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Delete(path?: string) {
  return function (target: any, propertyKey: string | symbol, parameterDesc: TypedPropertyDescriptor<Function>) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.method = "DELETE";
    route.path = path || "";
    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Data() {
  return function (target: any, propertyKey: string | symbol, index: number) {
    let router: any = Reflect.getMetadata("__router", target) || {};
    let routes = router.routes || [];
    let route = routes[propertyKey] || {};

    route.args = route.args || [];
    route.args[index] = {type: "data"};

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
    route.args[index] = {type: "ctx"};

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
    route.args[index] = {type: "param", opt: key};

    routes[propertyKey] = route;
    router["routes"] = routes;

    Reflect.defineMetadata("__router", router, target);
  };
}

export function Controller(root?: string) {
  return function (target: any): any {
    let router: any = Reflect.getMetadata("__router", target.prototype) || {};
    router.root = root || "/";
    Reflect.defineMetadata("__router", router, target.prototype);
  };
}