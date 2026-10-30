/**
 * Oracle subject for the unified polymorphic history engine (D-15), the only
 * history engine since U-7: `createStandardKernel()`.
 */
import { createKernelSubject } from './kernelSubject.js';
import type { HistoryOracleSubjectFactory } from './subject.js';

export const createUnifiedSubject: HistoryOracleSubjectFactory = createKernelSubject();
