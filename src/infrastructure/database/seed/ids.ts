// Fixed seed IDs, referenced by scripts/demo.sh, http/booking.http and the README.

const id = (suffix: string): string => `8b1f0c2e-0000-4000-8000-${suffix.padStart(12, '0')}`;

export const SEED_IDS = {
  dealerships: {
    northsideMotors: id('1'),
    saigonAutoService: id('2'),
  },
  customers: {
    samCarter: id('101'),
    jordanBlake: id('102'),
    linhNguyen: id('103'),
    baoTran: id('104'),
  },
  vehicles: {
    samCarterFocus: id('201'),
    jordanBlakeModel3: id('202'),
    linhNguyenVios: id('203'),
    baoTranVf8: id('204'),
  },
  serviceTypes: {
    oilService: id('301'),
    brakeReplacement: id('302'),
    evBatteryCheck: id('303'),
    annualService: id('304'),
  },
  serviceBays: {
    northsideBay1: id('401'),
    northsideBay2: id('402'),
    northsideBay3: id('403'),
    saigonBayA: id('411'),
    saigonBayB: id('412'),
  },
  technicians: {
    alexMorgan: id('501'),
    priyaShah: id('502'),
    tomReed: id('503'),
    minhTran: id('511'),
    lanPham: id('512'),
  },
} as const;
