import { demoDataset } from './demo.js';
import type { Dataset } from './types.js';

export type { Dataset } from './types.js';

export const datasets: Dataset[] = [demoDataset];

export function datasetById(id: string): Dataset | undefined {
    return datasets.find(d => d.id === id);
}
