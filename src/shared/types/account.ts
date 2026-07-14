export interface Account {
  id: string;
  rawName: string;
  friendlyName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountInput {
  rawName: string;
  friendlyName: string;
}

export interface UpdateAccountInput {
  rawName?: string;
  friendlyName?: string;
}
