export interface AccountAlias {
  id: string;
  accountId: string;
  rawName: string;
  createdAt: string;
}

export interface CreateAccountAliasInput {
  accountId: string;
  rawName: string;
}
