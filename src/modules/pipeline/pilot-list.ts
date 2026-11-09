import { z } from 'zod';

const place = z.object({
  state: z.string().trim().length(2),
  name: z.string().trim().min(1).max(150),
});

const special = place.extend({
  source: z.string().trim().min(1).max(150).optional(),
});

const fileSchema = z
  .object({
    states: z.array(z.string().trim().length(2)).max(56).default([]),
    counties: z.array(place).max(500).default([]),
    places: z.array(place).max(500).default([]),
    schoolDistricts: z.array(place).max(500).default([]),
    specialDistricts: z.array(special).max(500).default([]),
  })
  .strict();

export interface PilotPlace {
  state: string;
  name: string;
  source?: string;
}

export interface PilotList {
  states: string[];
  counties: PilotPlace[];
  places: PilotPlace[];
  schoolDistricts: PilotPlace[];
  specialDistricts: PilotPlace[];
}

export function pilotListFromStateCounty(state: string, county: string): PilotList {
  return {
    states: [state.toUpperCase()],
    counties: [{ state: state.toUpperCase(), name: county.trim() }],
    places: [],
    schoolDistricts: [],
    specialDistricts: [],
  };
}

export function parsePilotList(text: string): PilotList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Pilot list must be a JSON file.');
  }
  const result = fileSchema.safeParse(parsed);
  if (!result.success) throw new Error('Pilot list is missing states or place names.');
  const states = [...new Set(result.data.states.map((code) => code.toUpperCase()))];
  const mapPlace = (row: { state: string; name: string; source?: string | undefined }): PilotPlace => {
    const placeRow: PilotPlace = { state: row.state.toUpperCase(), name: row.name.trim() };
    if (row.source) placeRow.source = row.source.trim();
    return placeRow;
  };
  return {
    states,
    counties: result.data.counties.map(mapPlace),
    places: result.data.places.map(mapPlace),
    schoolDistricts: result.data.schoolDistricts.map(mapPlace),
    specialDistricts: result.data.specialDistricts.map(mapPlace),
  };
}

export function pilotStates(list: PilotList): string[] {
  const codes = new Set(list.states.map((code) => code.toUpperCase()));
  for (const group of [list.counties, list.places, list.schoolDistricts, list.specialDistricts]) {
    for (const placeRow of group) codes.add(placeRow.state.toUpperCase());
  }
  return [...codes];
}
