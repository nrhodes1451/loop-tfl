/**
 * In-memory generated HUBKGX for unit tests. Not loaded at runtime —
 * production uses data/schematic/generated/HUBKGX.json.
 */

import { HUBKGX_ORIGIN } from "./geo";
import { generateSchematic, type GenerateStationInput } from "./generate";

export const kgxFixtureInput: GenerateStationInput = {
  id: "HUBKGX",
  name: "King's Cross St Pancras",
  lat: HUBKGX_ORIGIN.lat,
  lon: HUBKGX_ORIGIN.lon,
  platforms: [
    {
      id: "HUBKGX-Plat01-WB-circle::circle::West",
      lineId: "circle",
      direction: "West",
      label: "Platform 1 westbound",
    },
    {
      id: "HUBKGX-Plat02-EB-circle::circle::East",
      lineId: "circle",
      direction: "East",
      label: "Platform 2 eastbound",
    },
    {
      id: "HUBKGX-Plat03-NB-victoria::victoria::North",
      lineId: "victoria",
      direction: "North",
      label: "Platform 3 northbound",
    },
    {
      id: "HUBKGX-Plat04-SB-victoria::victoria::South",
      lineId: "victoria",
      direction: "South",
      label: "Platform 4 southbound",
    },
    {
      id: "HUBKGX-Plat07-NB-northern::northern::North",
      lineId: "northern",
      direction: "North",
      label: "Platform 7 northbound",
    },
    {
      id: "HUBKGX-Plat08-SB-northern::northern::South",
      lineId: "northern",
      direction: "South",
      label: "Platform 8 southbound",
    },
  ],
  lifts: [
    {
      id: "HUBKGX-Lift-1",
      name: "Lift 1",
      platformIds: ["HUBKGX-Plat07-NB-northern::northern::North"],
    },
  ],
  platformLiftChains: [
    {
      platformId: "HUBKGX-Plat07-NB-northern::northern::North",
      liftIds: ["HUBKGX-Lift-1"],
      access: "lifts",
    },
  ],
  interchangeChains: [],
  placement: [
    {
      lineId: "northern",
      platformNumbers: [7, 8],
      eastM: 0,
      northM: 40,
      bearingDeg: 0,
    },
  ],
};

export const kgxStation = generateSchematic(kgxFixtureInput);
