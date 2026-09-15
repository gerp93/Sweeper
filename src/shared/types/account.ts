export interface Account {
  id: string;
  friendlyName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountInput {
  friendlyName: string;
}

export interface UpdateAccountInput {
  friendlyName?: string;
}
