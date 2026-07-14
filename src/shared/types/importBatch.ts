export interface ImportBatch {
  id: string;
  fileName: string;
  importedAt: string;
  rowCount: number;
  includedCount: number;
  excludedCount: number;
}

export interface CreateImportBatchInput {
  fileName: string;
  rowCount: number;
  includedCount: number;
  excludedCount: number;
}
