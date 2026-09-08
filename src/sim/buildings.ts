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
    color: 0xb8b0a8,
    roofColor: 0x7d7671,
    height: 0.95,
    blurb: 'Pays well no matter what. Poisons everything around it.',
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
