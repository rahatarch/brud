/**
 * Oracle subject for the unified polymorphic history engine (D-15):
 * `createStandardKernel({ historyEngine: 'unified' })`.
 */
import { createKernelSubject } from './kernelSubject.js';
import type { HistoryOracleSubjectFactory } from './subject.js';

export const createUnifiedSubject: HistoryOracleSubjectFactory = createKernelSubject('unified');
