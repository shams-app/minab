import { demoDataset } from './demo.js';
import { persianDataset } from './persian.js';
import type { Dataset } from './types.js';

export type { Dataset } from './types.js';

export const datasets: Dataset[] = [demoDataset, persianDataset];

export function datasetById(id: string): Dataset | undefined {
    return datasets.find(d => d.id === id);
}
