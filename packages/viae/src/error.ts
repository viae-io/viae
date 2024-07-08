export class ViaeError extends Error {
  constructor(public status: number, message?: string) {
      super(message); 
  }
}