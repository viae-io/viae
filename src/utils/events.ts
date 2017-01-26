export class EventEmitter {
  private _events: { [name: string]: Array<(...args) => void>; } = {};

  /** 
   * Add event handler for an event name. 
   * @returns disposable to remove event handler. 
  */
  on(event: string, cb: (...args) => void): () => void {
    let handler = this._events[event] = this._events[event] || [];

    handler.push(cb);

    return () => {
      let index = handler.indexOf(cb);
      if (index > -1)
        handler.splice(index, 1);
    };
  }
  
  /** 
   * emit an event with args
   */
  protected emit(event: string, ...args) {
    if (this._events[event] == undefined)
      return;

    for (const handler of this._events[event]) {
      handler(...args);
    }
  }
}