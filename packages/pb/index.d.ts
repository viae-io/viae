import { MessageFrame } from "@viae/core";
export declare class FrameEncoder {
    private _pool;
    constructor();
    encode(frame: MessageFrame): Uint8Array;
    decode(buffer: Uint8Array): MessageFrame;
}
