export enum Status {
  // Informational 

  // Success 

  Okay = 200,
  OkayPartial = 206,

  // Client Error 

  BadRequest = 400,
  Unauthorized = 401,  
  Forbidden = 403,
  NotFound = 404,

  // Server Error 

  Error = 500  
}