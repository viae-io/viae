export enum ViaStatus{
  Continue = 100,
  
  OK = 200,  
  BadRequest = 400,
  NotFound = 404,
  InternalError = 503,

  Next = 100,
  Done = 200,
  Error = 503
}