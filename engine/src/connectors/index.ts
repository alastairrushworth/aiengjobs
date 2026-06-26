import type { AtsProvider } from "@aiengjobs/shared";
import type { Connector } from "./types.ts";
import { greenhouse } from "./greenhouse.ts";
import { lever } from "./lever.ts";
import { ashby } from "./ashby.ts";

// Registry of the ATS connectors we build ourselves (spec §6.6 recommendation).
export const CONNECTORS: Partial<Record<AtsProvider, Connector>> = {
  greenhouse,
  lever,
  ashby,
};

export function getConnector(provider: AtsProvider): Connector | undefined {
  return CONNECTORS[provider];
}

export type { Connector, RawPosting } from "./types.ts";
