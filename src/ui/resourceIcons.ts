/**
 * One small icon per topstrip readout (coins, income rate, happiness,
 * population, the info button) — the topstrip equivalent of
 * buildingIcons.ts. Vite resolves each import to the built asset's URL.
 */
import coins from '../assets/resources/coins.png'
import happiness from '../assets/resources/happiness.png'
import income from '../assets/resources/income.png'
import info from '../assets/resources/info.png'
import population from '../assets/resources/population.png'

export const RESOURCE_ICONS = {
  coins,
  income,
  happiness,
  population,
  info,
}
