/** Status codes - aligned with HTTP semantics */
export enum Status {
  OK = 200,
  Partial = 206,
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFound = 404,
  Error = 500,
}
