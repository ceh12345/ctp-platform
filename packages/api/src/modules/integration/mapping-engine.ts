import { Injectable } from '@nestjs/common';
import { IMappingProfile } from '../../config/interfaces/config-store.interface';
import { IRawDataPayload } from './adapter.interface';

@Injectable()
export class MappingEngine {
  // Phase 1: identity pass-through — profile is accepted but unused.
  // Phase 2 will implement field-level transforms via the mapping profile.
  transform(raw: IRawDataPayload, _profile: IMappingProfile | null): IRawDataPayload {
    return raw;
  }
}
