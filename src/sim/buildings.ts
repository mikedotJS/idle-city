import { FACTORY_COINS, LANDFILL_COINS } from './config'
import type { BuildingType } from './types'

export interface Emission {
  /** Positive raises happiness, negative lowers it. */
  strength: number
  /** Tiles of euclidean reach; contribution falls off linearly to zero. */
  range: number
}

export interface BuildingDef {
  type: BuildingType
  label: string
  baseCost: number
  costGrowth: number
  /** 'queue' buildings are placed by the auto-builder; 'manual' ones by the player. */
  placement: 'queue' | 'manual'
  emit?: Emission
  /**
   * Flat coins per second at level 1, before the happiness multiplier. Shops
   * are absent here: they earn from the population near them, which is not a
   * constant. Everything else that earns does so by standing still.
   */
  coins?: number
  /** Only placeable on a land tile that touches water. */
  coastOnly?: boolean
  /** Base body colour, pastel. The renderer jitters hue slightly per instance. */
  color: number
  /** Roof colour. */
  roofColor: number
  /** Base body height in tile units, before per-instance jitter. */
  height: number
  /**
   * Whether sustained misery can shut this building down. Only what the city
   * builds for itself can rot; what you placed by hand stays exactly where you
   * put it. A factory is indifferent to whether anyone wants to live near it —
   * that indifference is the whole temptation — and a park in a bad district is
   * simply a park losing an argument, which the stacking field already models.
   */
  derelictable: boolean

  /** One-line explanation shown in the UI. */
  blurb: string
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  house: {
    type: 'house',
    derelictable: true,
    label: 'House',
    baseCost: 20,
    costGrowth: 1.15,
    placement: 'queue',
    color: 0xe8d5c4,
    roofColor: 0xc98d78,
    height: 0.55,
    blurb: 'Holds 4 people, but only where it is pleasant enough to live.',
  },
  shop: {
    type: 'shop',
    derelictable: true,
    label: 'Shop',
    baseCost: 60,
    costGrowth: 1.15,
    placement: 'queue',
    color: 0xf2e2b6,
    roofColor: 0x8fb996,
    height: 0.75,
    blurb: 'Earns from every resident living nearby.',
  },
  factory: {
    type: 'factory',
    derelictable: false,
    label: 'Factory',
    baseCost: 200,
    costGrowth: 1.25,
    placement: 'manual',
    emit: { strength: -1.0, range: 3.5 },
    coins: FACTORY_COINS,
    color: 0xb8b0a8,
    roofColor: 0x7d7671,
    height: 0.95,
    blurb: 'Pays well no matter what. Poisons everything around it.',
  },
  station: {
    type: 'station',
    derelictable: false,
    label: 'Station',
    baseCost: 320,
    costGrowth: 1.3,
    placement: 'manual',
    emit: { strength: 0.5, range: 3.0 },
    color: 0xd9c9ae,
    roofColor: 0x8a7f72,
    height: 0.62,
    blurb: 'Puts a place on the map. Rails link every station you build.',
  },
  school: {
    type: 'school',
    derelictable: false,
    label: 'School',
    baseCost: 260,
    costGrowth: 1.22,
    placement: 'manual',
    // Reaches further than a park and lifts less. A park fixes one bad corner;
    // a school raises a whole district a little.
    emit: { strength: 0.45, range: 4.5 },
    color: 0xe4d3bc,
    roofColor: 0xa8564a,
    height: 0.72,
    blurb: 'Lifts a whole district a little, where a park lifts one corner a lot.',
  },
  harbour: {
    type: 'harbour',
    derelictable: false,
    label: 'Harbour',
    baseCost: 300,
    costGrowth: 1.25,
    placement: 'manual',
    emit: { strength: 0.7, range: 3.0 },
    coastOnly: true,
    color: 0xcfd8d2,
    roofColor: 0x5d7f86,
    height: 0.5,
    blurb: 'Only on the coast. Worth more than a park, if you have a shore.',
  },
  landfill: {
    type: 'landfill',
    derelictable: false,
    label: 'Landfill',
    baseCost: 90,
    // Steeper than the factory's 1.25: a row of landfills has to stop being
    // the obvious answer well before a row of factories does.
    costGrowth: 1.3,
    placement: 'manual',
    // The factory's opposite number, and the numbers had to be measured to
    // make that true: at -1.4 it was strictly gentler than the factory at
    // every distance, which is not a trade, it is a worse building. At -2.6
    // over 1.8 tiles it makes 9 tiles unlivable to the factory's 21, and a
    // park cannot rescue any of the 9 — where a park does rescue the tile
    // beside a factory. Cheap ruin you can wall off, against expensive ruin
    // that seeps.
    emit: { strength: -2.6, range: 1.8 },
    coins: LANDFILL_COINS,
    color: 0x9a9384,
    roofColor: 0x6e675c,
    height: 0.34,
    blurb: 'Cheap money, and a small circle of misery you can build around.',
  },
  park: {
    type: 'park',
    derelictable: false,
    label: 'Park',
    baseCost: 80,
    costGrowth: 1.2,
    placement: 'manual',
    emit: { strength: 0.8, range: 2.5 },
    color: 0x9ec89b,
    roofColor: 0x6fa473,
    height: 0.18,
    blurb: 'Earns nothing. Makes everything near it worth living next to.',
  },
}

export const BUILDING_TYPES = Object.keys(BUILDINGS) as BuildingType[]

/** Cost of the next building of this type, given how many have ever been built. */
export function buildingCost(type: BuildingType, builtCount: number): number {
  const def = BUILDINGS[type]
  return Math.floor(def.baseCost * Math.pow(def.costGrowth, builtCount))
}
