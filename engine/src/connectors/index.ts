import type { AtsProvider } from "@aiengjobs/shared";
import type { Connector } from "./types.ts";
import { greenhouse } from "./greenhouse.ts";
import { lever } from "./lever.ts";
import { ashby } from "./ashby.ts";
import { workable } from "./workable.ts";
import { recruitee } from "./recruitee.ts";
import { teamtailor } from "./teamtailor.ts";
import { smartrecruiters } from "./smartrecruiters.ts";
import { workday } from "./workday.ts";
import { oracle } from "./oracle.ts";
import { eightfold } from "./eightfold.ts";
import { icims } from "./icims.ts";
import { successfactors } from "./successfactors.ts";

// Registry of the ATS connectors we build ourselves (spec §6.6 recommendation).
export const CONNECTORS: Partial<Record<AtsProvider, Connector>> = {
  greenhouse,
  lever,
  ashby,
  workable,
  recruitee,
  teamtailor,
  smartrecruiters,
  workday,
  oracle,
  eightfold,
  icims,
  successfactors,
};

export function getConnector(provider: AtsProvider): Connector | undefined {
  return CONNECTORS[provider];
}

export type { Connector, RawPosting } from "./types.ts";
