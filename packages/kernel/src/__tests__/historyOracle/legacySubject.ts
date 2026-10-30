/**
 * Oracle subject for the two legacy history engines (pre-D-15):
 * `createStandardKernel({ historyEngine: 'legacy' })`, the default.
 */
import { createKernelSubject } from './kernelSubject.js';
import type { HistoryOracleSubjectFactory } from './subject.js';

export const createLegacySubject: HistoryOracleSubjectFactory = createKernelSubject('legacy');
