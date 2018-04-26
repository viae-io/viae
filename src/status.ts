export enum Status {
  // Informational 

  Next = 100,

  // Success 

  OK = 200,

  // Client Error 

  BadRequest = 400,
  Unauthorized = 401,  
  Forbidden = 403,
  NotFound = 404,

  // Server Error 

  Error = 500  
}