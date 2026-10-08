import { nextCandidatePair } from '../../src/domain/allocation';

const technicians = [
  { id: 't1', name: 'Alex' },
  { id: 't2', name: 'Blair' },
];
const bays = [
  { id: 'b1', name: 'Bay 1' },
  { id: 'b2', name: 'Bay 2' },
];
const none = new Set<string>();

describe('nextCandidatePair (first-fit)', () => {
  it('UT-AL-01 returns the first technician and the first bay in order', () => {
    expect(nextCandidatePair(technicians, bays, none, none)).toEqual({
      technician: technicians[0],
      bay: bays[0],
    });
  });

  it('UT-AL-02 skips an excluded bay and keeps the technician', () => {
    expect(nextCandidatePair(technicians, bays, none, new Set(['b1']))).toEqual({
      technician: technicians[0],
      bay: bays[1],
    });
  });

  it('UT-AL-03 skips an excluded technician and keeps the bay', () => {
    expect(nextCandidatePair(technicians, bays, new Set(['t1']), none)).toEqual({
      technician: technicians[1],
      bay: bays[0],
    });
  });

  it('UT-AL-04 returns no pair when every bay or every technician is excluded', () => {
    expect(nextCandidatePair(technicians, bays, none, new Set(['b1', 'b2']))).toBeNull();
    expect(nextCandidatePair(technicians, bays, new Set(['t1', 't2']), none)).toBeNull();
    expect(nextCandidatePair([], bays, none, none)).toBeNull();
    expect(nextCandidatePair(technicians, [], none, none)).toBeNull();
  });
});
