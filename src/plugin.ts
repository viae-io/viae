import { Viae } from './viae';
import { Via } from './via';

export type Plugin = {
  plugin(target: Viae | Via): void
};

export function isPlugin(item: any): item is Plugin {
  return item["plugin"] !== undefined;
}
