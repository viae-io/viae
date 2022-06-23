export class EventBus {
  private _e: { [name: string]: Array<(...args) => void>; } = {};
  /** 
   * Add an event-handler for an event name. 
   * @returns disposable to remove the event-handler. 
  */
  on(event: string, cb: (...args) => void): () => void {
    let h = this._e[event] = this._e[event] || [];
    h.push(cb);
    return () => this.off(event, cb);
  }

  off(event: string, cb: (...args) => void) {
    let h = this._e[event] = this._e[event] || [];
    let i = h.indexOf(cb);
    if (i > -1)
      h.splice(i, 1);
  }
  
  /** 
   * Add a one-time event-handler for an event name. 
   * @returns disposable to remove the event-handler. 
  */
  once(event: string, cb: (...args) => void): () => void {
    let d = this.on(event, (...args) => {
      d();
      cb(...args);
    });
    return d;
  }

  wait(event: string): Promise<any>{
    let resolve;
    let promise = new Promise((r, _)=>{
      resolve = r;
    });

    this.once(event, (...args:any[])=>{
      resolve(args);
    });
    return promise;
  }

  /** 
   * emit an event with args
   */
  emit(event: string, ...args) {
    if (this._e[event] == undefined)
      return;
    for (const h of this._e[event]) {
      h(...args);
    }
  }
}