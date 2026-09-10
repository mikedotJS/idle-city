/**
 * One small isometric icon per building type, shown wherever the HUD names
 * a building instead of just drawing it in 3D: the build palette, the queue,
 * and the hover panel. Vite resolves each import to the built asset's URL.
 */
import type { BuildingType } from '../sim/types'
import factory from '../assets/buildings/factory.png'
import harbour from '../assets/buildings/harbour.png'
import house from '../assets/buildings/house.png'
import landfill from '../assets/buildings/landfill.png'
import park from '../assets/buildings/park.png'
import school from '../assets/buildings/school.png'
import shop from '../assets/buildings/shop.png'
import station from '../assets/buildings/station.png'

export const BUILDING_ICONS: Record<BuildingType, string> = {
  house,
  shop,
  factory,
  station,
  school,
  harbour,
  landfill,
  park,
}
