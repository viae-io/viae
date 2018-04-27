class ExtensibleProxy {
  constructor() {
    return new Proxy(this, {
      set: (object, key, value, proxy) => {
        object[key] = value;
        console.log('PROXY SET');
        return true;
      }
    });
  }
}

class ChildProxyClass extends ExtensibleProxy {
  [index: string]: any;
}

let myProxy = new ChildProxyClass();

// Should set myProxy.a to 3 and print 'PROXY SET' to the console:
myProxy.a = 3;