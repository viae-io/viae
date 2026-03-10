import { Status } from "./status.js";

export class ViaeError extends Error {
  constructor(public status: Status, message: string) {
    super(message);
  }
}
