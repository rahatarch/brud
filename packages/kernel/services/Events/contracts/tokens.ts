import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IEventsService } from './IEventsService.js';

export const EventsToken = createServiceToken<IEventsService>('brud.core.events');