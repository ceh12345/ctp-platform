import { Rule } from '../validation-types';
import { CrossEntityRefsRule } from './cross-entity-refs';
import { DateParseabilityRule } from './date-parseability';
import { RecordCountPlausibilityRule } from './record-count-plausibility';
import { RequiredFieldsRule } from './required-fields';

export { CrossEntityRefsRule } from './cross-entity-refs';
export { DateParseabilityRule } from './date-parseability';
export { RecordCountPlausibilityRule } from './record-count-plausibility';
export { RequiredFieldsRule } from './required-fields';

export function defaultRules(): Rule[] {
  return [
    new RecordCountPlausibilityRule(),
    new RequiredFieldsRule(),
    new DateParseabilityRule(),
    new CrossEntityRefsRule(),
  ];
}
