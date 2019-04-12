export class ViaeError extends Error {
  constructor(public status: number, message?: string) {
      super(message); // 'Error' breaks prototype chain here
      Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
  }
}