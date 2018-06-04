// import { Rowan, If, Middleware } from "rowan";
// import { RequestContext, Context } from "../context";
// import { request } from "./request";
// import { v4 as uuid } from 'uuid';
// import { Message, Status } from "..";
// import { connect } from "tls";


// export class StreamIteratorRouter extends Rowan<RequestContext> {
//   constructor(iterable: AsyncIterable<any>, dispose: () => void) {
//     super();

//     let sid = uuid();
//     let flowing = null;
//     let resumeResolve = null;
//     let resumeReject = null;
//     let resume = null;
//     let worker = null;
//     let quit = false;

//     this.use(new If(request("OPEN"), [
//       async (ctx, next) => {
//         try {
//           sid = ctx.in.head.sid;
//           if (typeof sid != "string") {
//             throw (Status.BadRequest);
//           }
//           ctx.reply(200, { sid: sid });
//           const connection = ctx.connection;

//           worker = async function () {
//             try {
//               for await (let item of iterable) {
//                 connection.send({ id: sid, body: item });
//                 if (resume) {
//                   await resume;
//                 }
//                 if (quit) {
//                   break;
//                 }
//               }
//             } catch (err) {
//               connection.on("error", err);
//             } finally {
//               dispose();
//             }

//             connection.on("close", () => {
//               quit = true;
//               dispose();
//             });
//           }();
//         } catch (err) {
//           dispose();
//           throw err;
//         }
//       }])
//     );

//     this.use(new If(request("PAUSE"), [
//       async (ctx, next) => {
//         resume = new Promise((r, x) => { resumeResolve = r, resumeReject = x; });
//         ctx.reply(200);
//       }])
//     );

//     this.use(new If(request("UNPAUSE"), [
//       async (ctx, next) => {
//         if (resumeResolve) {
//           resumeResolve();
//         }
//         ctx.reply(200);
//       }])
//     );

//     this.use(new If(request("CLOSE"), [
//       async (ctx, next) => {
//         try {
//           quit = true;
//           ctx.reply(200);
//         } finally {
//           dispose();
//         }
//       }])
//     );
//   }
// }


// export class UpgradeOutgoingIterable implements Middleware<Context> {
//   process(ctx: Context, next: () => Promise<void>) {
//     const head = ctx.out.head;
//     const body = ctx.out.body;
//     if (body != undefined && body[Symbol.asyncIterator] != undefined && ((head ? head.iterable : true) || true)) {
//       let iterable = body;
//       let sid = uuid();
//       let router = new StreamIteratorRouter(iterable, function () { dispose(); });
//       let dispose = ctx.connection.intercept(sid, [router]);

//       head["iterable"] = sid;
//     }
//     return next();
//   }
// }

// export class UpgradeIncomingIterable implements Middleware<Context> {
//   process(ctx: Context, next: () => Promise<void>) {
//     if (!ctx.in || !ctx.in.body || typeof ctx.in.head["iterable"] !== "string") {
//       return next();
//     }

//     const sid = ctx.in.head["iterable"] as string;
//     const connection = ctx.connection;

//     ctx.in.body[Symbol.asyncIterator] = function (): AsyncIterator<any> {
//       let response: Message;
//       let subscribed = false;

//       return {
//         next: async function (): Promise<IteratorResult<any>> {
//           if (!subscribed) {
//             subscribed = true;
//             response = await connection.request({ id: sid, head: { method: "SUBSCRIBE" } });
//             if (response.head.status != 200) {
//               throw Error(response.body);
//             }
//           }

//           response = await connection.request({ id: sid, head: { method: "NEXT" } });

//           switch (response.head.status) {
//             case 206:
//               return { value: response.body, done: false };
//             case 200:
//               return { value: undefined, done: true };
//             default:
//             case 500:
//               throw Error(response.body || "Unknown Error");
//           }
//         },
//         return: async function () {
//           response = await connection.request({ id: sid, head: { method: "UNSUBSCRIBE" } });
//           return { value: undefined, done: true };
//         }
//       };
//     };

//     return next();
//   }
// }