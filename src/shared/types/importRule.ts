export type RuleField = 'description' | 'memo';
export type RuleMatchType = 'contains' | 'equals' | 'startsWith' | 'endsWith';

export interface ImportRule {
  id: string;
  field: RuleField;
  matchType: RuleMatchType;
  pattern: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateImportRuleInput {
  field: RuleField;
  matchType: RuleMatchType;
  pattern: string;
  isActive?: boolean;
}

export interface UpdateImportRuleInput {
  field?: RuleField;
  matchType?: RuleMatchType;
  pattern?: string;
  isActive?: boolean;
}
