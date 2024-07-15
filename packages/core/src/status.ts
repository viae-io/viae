export enum Status {
  // Informational 

  Processing = 102,

  // Success 

  OK = 200,
  OkayPartial = 206,

  // Client Error 

  BadRequest = 400,
  Unauthorized = 401,  
  Forbidden = 403,
  NotFound = 404,

  // Server Error 

  Error = 500  
}