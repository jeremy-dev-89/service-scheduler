export interface Identified {
  readonly id: string;
}

export interface CandidatePair<T extends Identified, B extends Identified> {
  readonly technician: T;
  readonly bay: B;
}

/**
 * First-fit allocation (AS9, ADR-003): the first technician not excluded, paired with the
 * first bay not excluded. Inputs are already in a stable order (name, then id).
 * Returns null when no technician or no bay is left.
 */
export function nextCandidatePair<T extends Identified, B extends Identified>(
  technicians: readonly T[],
  bays: readonly B[],
  excludedTechnicianIds: ReadonlySet<string>,
  excludedBayIds: ReadonlySet<string>,
): CandidatePair<T, B> | null {
  const technician = technicians.find((t) => !excludedTechnicianIds.has(t.id));
  const bay = bays.find((b) => !excludedBayIds.has(b.id));
  return technician && bay ? { technician, bay } : null;
}
